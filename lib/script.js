'use strict';


var Address = require('./address');
var BufferReader = require('./encoding/bufferreader');
var BufferWriter = require('./encoding/bufferwriter');
var Hash = require('./crypto/hash');
var Opcode = require('./opcode');
var PublicKey = require('./publickey');
var Signature = require('./crypto/signature');

var $ = require('./util/preconditions');
var _ = require('lodash');
var errors = require('./errors');
var buffer = require('buffer');
var BufferUtil = require('./util/buffer');
var jsUtil = require('./util/js');

/**
 * A bitcoin transaction script. Each transaction's inputs and outputs
 * has a script that is evaluated to validate it's spending.
 *
 * See https://en.bitcoin.it/wiki/Script
 *
 * @constructor
 * @param {Object|string|Buffer} [from] optional data to populate script
 */
var Script = function Script(from) {
  if (!(this instanceof Script)) {
    return new Script(from);
  }

  this.chunks = [];

  if (BufferUtil.isBuffer(from)) {
    return Script.fromBuffer(from);
  } else if (from instanceof Address) {
    return Script.fromAddress(from);
  } else if (from instanceof Script) {
    return Script.fromBuffer(from.toBuffer());
  } else if (typeof from === 'string') {
    return Script.fromString(from);
  } else if (typeof from !== 'undefined') {
    this.set(from);
  }
};

Script.prototype.set = function(obj) {
  this.chunks = obj.chunks || this.chunks;
  return this;
};

Script.fromBuffer = function(buffer) {
  var script = new Script();
  script.chunks = [];

  var br = new BufferReader(buffer);
  while (!br.eof()) {
    var opcodenum = br.readUInt8();

    var len, buf;
    if (opcodenum > 0 && opcodenum < Opcode.OP_PUSHDATA1) {
      len = opcodenum;
      script.chunks.push({
        buf: br.read(len),
        len: len,
        opcodenum: opcodenum
      });
    } else if (opcodenum === Opcode.OP_PUSHDATA1) {
      len = br.readUInt8();
      buf = br.read(len);
      script.chunks.push({
        buf: buf,
        len: len,
        opcodenum: opcodenum
      });
    } else if (opcodenum === Opcode.OP_PUSHDATA2) {
      len = br.readUInt16LE();
      buf = br.read(len);
      script.chunks.push({
        buf: buf,
        len: len,
        opcodenum: opcodenum
      });
    } else if (opcodenum === Opcode.OP_PUSHDATA4) {
      len = br.readUInt32LE();
      buf = br.read(len);
      script.chunks.push({
        buf: buf,
        len: len,
        opcodenum: opcodenum
      });
    } else {
      script.chunks.push({
        opcodenum: opcodenum
      });
    }
  }

  return script;
};

Script.prototype.toBuffer = function() {
  var bw = new BufferWriter();

  for (var i = 0; i < this.chunks.length; i++) {
    var chunk = this.chunks[i];
    var opcodenum = chunk.opcodenum;
    bw.writeUInt8(chunk.opcodenum);
    if (chunk.buf) {
      if (opcodenum < Opcode.OP_PUSHDATA1) {
        bw.write(chunk.buf);
      } else if (opcodenum === Opcode.OP_PUSHDATA1) {
        bw.writeUInt8(chunk.len);
        bw.write(chunk.buf);
      } else if (opcodenum === Opcode.OP_PUSHDATA2) {
        bw.writeUInt16LE(chunk.len);
        bw.write(chunk.buf);
      } else if (opcodenum === Opcode.OP_PUSHDATA4) {
        bw.writeUInt32LE(chunk.len);
        bw.write(chunk.buf);
      }
    }
  }

  return bw.concat();
};

Script.fromString = function(str) {
  if (jsUtil.isHexa(str)) {
    return new Script(new buffer.Buffer(str, 'hex'));
  }
  var script = new Script();
  script.chunks = [];

  var tokens = str.split(' ');
  var i = 0;
  while (i < tokens.length) {
    var token = tokens[i];
    var opcode = Opcode(token);
    var opcodenum = opcode.toNumber();

    if (typeof opcodenum === 'undefined') {
      opcodenum = parseInt(token);
      if (opcodenum > 0 && opcodenum < Opcode.OP_PUSHDATA1) {
        script.chunks.push({
          buf: new Buffer(tokens[i + 1].slice(2), 'hex'),
          len: opcodenum,
          opcodenum: opcodenum
        });
        i = i + 2;
      } else {
        throw new Error('Invalid script: ' + JSON.stringify(str));
      }
    } else if (opcodenum === Opcode.OP_PUSHDATA1 ||
      opcodenum === Opcode.OP_PUSHDATA2 ||
      opcodenum === Opcode.OP_PUSHDATA4) {
      if (tokens[i + 2].slice(0, 2) !== '0x') {
        throw new Error('Pushdata data must start with 0x');
      }
      script.chunks.push({
        buf: new Buffer(tokens[i + 2].slice(2), 'hex'),
        len: parseInt(tokens[i + 1]),
        opcodenum: opcodenum
      });
      i = i + 3;
    } else {
      script.chunks.push({
        opcodenum: opcodenum
      });
      i = i + 1;
    }
  }
  return script;
};

Script.prototype.toString = function() {
  var str = '';

  for (var i = 0; i < this.chunks.length; i++) {
    var chunk = this.chunks[i];
    var opcodenum = chunk.opcodenum;
    if (!chunk.buf) {
      if (typeof Opcode.reverseMap[opcodenum] !== 'undefined') {
        str = str + ' ' + Opcode(opcodenum).toString();
      } else {
        str = str + ' ' + '0x' + opcodenum.toString(16);
      }
    } else {
      if (opcodenum === Opcode.OP_PUSHDATA1 ||
        opcodenum === Opcode.OP_PUSHDATA2 ||
        opcodenum === Opcode.OP_PUSHDATA4) {
        str = str + ' ' + Opcode(opcodenum).toString();
      }
      str = str + ' ' + chunk.len;
      str = str + ' ' + '0x' + chunk.buf.toString('hex');
    }
  }

  return str.substr(1);
};

Script.prototype.inspect = function() {
  return '<Script: ' + this.toString() + '>';
};

// script classification methods

/**
 * @returns true if this is a pay to pubkey hash output script
 */
Script.prototype.isPublicKeyHashOut = function() {
  return !!(this.chunks.length === 5 &&
    this.chunks[0].opcodenum === Opcode.OP_DUP &&
    this.chunks[1].opcodenum === Opcode.OP_HASH160 &&
    this.chunks[2].buf &&
    this.chunks[3].opcodenum === Opcode.OP_EQUALVERIFY &&
    this.chunks[4].opcodenum === Opcode.OP_CHECKSIG);
};

/**
 * @returns true if this is a pay to public key hash input script
 */
Script.prototype.isPublicKeyHashIn = function() {
  return this.chunks.length === 2 &&
    this.chunks[0].buf &&
    this.chunks[0].buf.length >= 0x47 &&
    this.chunks[0].buf.length <= 0x49 &&
    PublicKey.isValid(this.chunks[1].buf);
};

Script.prototype.getPublicKeyHash = function() {
  $.checkState(this.isPublicKeyHashOut(), 'Can\'t retrieve PublicKeyHash from a non-PKH output');
  return this.chunks[2].buf;
};

/**
 * @returns true if this is a public key output script
 */
Script.prototype.isPublicKeyOut = function() {
  return this.chunks.length === 2 &&
    BufferUtil.isBuffer(this.chunks[0].buf) &&
    PublicKey.isValid(this.chunks[0].buf) &&
    this.chunks[1].opcodenum === Opcode.OP_CHECKSIG;
};

/**
 * @returns true if this is a pay to public key input script
 */
Script.prototype.isPublicKeyIn = function() {
  return this.chunks.length === 1 &&
    BufferUtil.isBuffer(this.chunks[0].buf) &&
    this.chunks[0].buf.length === 0x47;
};


/**
 * @returns true if this is a p2sh output script
 */
Script.prototype.isScriptHashOut = function() {
  return this.chunks.length === 3 &&
    this.chunks[0].opcodenum === Opcode.OP_HASH160 &&
    this.chunks[1].buf &&
    this.chunks[1].buf.length === 20 &&
    this.chunks[2].opcodenum === Opcode.OP_EQUAL;
};

/** 
 * @returns true if this is a p2sh input script
 * Note that these are frequently indistinguishable from pubkeyhashin
 */
Script.prototype.isScriptHashIn = function() {
  if (this.chunks.length === 0) {
    return false;
  }
  var chunk = this.chunks[this.chunks.length - 1];
  if (!chunk) {
    return false;
  }
  var scriptBuf = chunk.buf;
  if (!scriptBuf) {
    return false;
  }
  var redeemScript = new Script(scriptBuf);
  var type = redeemScript.classify();
  return type !== Script.types.UNKNOWN;
};

/**
 * @returns true if this is a mutlsig output script
 */
Script.prototype.isMultisigOut = function() {
  return (this.chunks.length > 3 &&
    Opcode.isSmallIntOp(this.chunks[0].opcodenum) &&
    this.chunks.slice(1, this.chunks.length - 2).every(function(obj) {
      return obj.buf && BufferUtil.isBuffer(obj.buf);
    }) &&
    Opcode.isSmallIntOp(this.chunks[this.chunks.length - 2].opcodenum) &&
    this.chunks[this.chunks.length - 1].opcodenum === Opcode.OP_CHECKMULTISIG);
};


/**
 * @returns true if this is a multisig input script
 */
Script.prototype.isMultisigIn = function() {
  return this.chunks.length >= 2 &&
    this.chunks[0].opcodenum === 0 &&
    this.chunks.slice(1, this.chunks.length).every(function(obj) {
      return obj.buf &&
        BufferUtil.isBuffer(obj.buf) &&
        obj.buf.length === 0x47;
    });
};

/**
 * @returns true if this is an OP_RETURN data script
 */
Script.prototype.isDataOut = function() {
  return this.chunks.length >= 1 &&
    this.chunks[0].opcodenum === Opcode.OP_RETURN &&
    (this.chunks.length === 1 ||
      (this.chunks.length === 2 &&
        this.chunks[1].buf &&
        this.chunks[1].buf.length <= 40 &&
        this.chunks[1].length === this.chunks.len));
};

/**
 * @returns true if the script is only composed of data pushing
 * opcodes or small int opcodes (OP_0, OP_1, ..., OP_16)
 */
Script.prototype.isPushOnly = function() {
  return _.every(this.chunks, function(chunk) {
    return chunk.opcodenum <= Opcode.OP_16;
  });
};


Script.types = {};
Script.types.UNKNOWN = 'Unknown';
Script.types.PUBKEY_OUT = 'Pay to public key';
Script.types.PUBKEY_IN = 'Spend from public key';
Script.types.PUBKEYHASH_OUT = 'Pay to public key hash';
Script.types.PUBKEYHASH_IN = 'Spend from public key hash';
Script.types.SCRIPTHASH_OUT = 'Pay to script hash';
Script.types.SCRIPTHASH_IN = 'Spend from script hash';
Script.types.MULTISIG_OUT = 'Pay to multisig';
Script.types.MULTISIG_IN = 'Spend from multisig';
Script.types.DATA_OUT = 'Data push';

Script.identifiers = {};
Script.identifiers.PUBKEY_OUT = Script.prototype.isPublicKeyOut;
Script.identifiers.PUBKEY_IN = Script.prototype.isPublicKeyIn;
Script.identifiers.PUBKEYHASH_OUT = Script.prototype.isPublicKeyHashOut;
Script.identifiers.PUBKEYHASH_IN = Script.prototype.isPublicKeyHashIn;
Script.identifiers.MULTISIG_OUT = Script.prototype.isMultisigOut;
Script.identifiers.MULTISIG_IN = Script.prototype.isMultisigIn;
Script.identifiers.SCRIPTHASH_OUT = Script.prototype.isScriptHashOut;
Script.identifiers.SCRIPTHASH_IN = Script.prototype.isScriptHashIn;
Script.identifiers.DATA_OUT = Script.prototype.isDataOut;

/**
 * @returns {object} The Script type if it is a known form,
 * or Script.UNKNOWN if it isn't
 */
Script.prototype.classify = function() {
  for (var type in Script.identifiers) {
    if (Script.identifiers[type].bind(this)()) {
      return Script.types[type];
    }
  }
  return Script.types.UNKNOWN;
};


/**
 * @returns true if script is one of the known types
 */
Script.prototype.isStandard = function() {
  // TODO: Add BIP62 compliance
  return this.classify() !== Script.types.UNKNOWN;
};


// Script construction methods

/**
 * Adds a script element at the start of the script.
 * @param {*} obj a string, number, Opcode, Bufer, or object to add
 * @returns {Script} this script instance
 */
Script.prototype.prepend = function(obj) {
  this._addByType(obj, true);
  return this;
};

/**
 * Compares a script with another script
 */
Script.prototype.equals = function(script) {
  $.checkState(script instanceof Script, 'Must provide another script');
  if (this.chunks.length !== script.chunks.length) {
    return false;
  }
  var i;
  for (i = 0; i < this.chunks.length; i++) {
    if (BufferUtil.isBuffer(this.chunks[i]) && !BufferUtil.isBuffer(script.chunks[i])) {
      return false;
    } else if (this.chunks[i] instanceof Opcode && !(script.chunks[i] instanceof Opcode)) {
      return false;
    }
    if (BufferUtil.isBuffer(this.chunks[i]) && !BufferUtil.equals(this.chunks[i], script.chunks[i])) {
      return false;
    } else if (this.chunks[i].num !== script.chunks[i].num) {
      return false;
    }
  }
  return true;
};

/**
 * Adds a script element to the end of the script.
 *
 * @param {*} obj a string, number, Opcode, Bufer, or object to add
 * @returns {Script} this script instance
 *
 */
Script.prototype.add = function(obj) {
  this._addByType(obj, false);
  return this;
};

Script.prototype._addByType = function(obj, prepend) {
  if (typeof obj === 'string') {
    this._addOpcode(obj, prepend);
  } else if (typeof obj === 'number') {
    this._addOpcode(obj, prepend);
  } else if (obj.constructor && obj.constructor.name && obj.constructor.name === 'Opcode') {
    this._addOpcode(obj, prepend);
  } else if (BufferUtil.isBuffer(obj)) {
    this._addBuffer(obj, prepend);
  } else if (typeof obj === 'object') {
    this._insertAtPosition(obj, prepend);
  } else if (obj instanceof Script) {
    this.chunks = this.chunks.concat(obj.chunks);
  } else {
    throw new Error('Invalid script chunk');
  }
};

Script.prototype._insertAtPosition = function(op, prepend) {
  if (prepend) {
    this.chunks.unshift(op);
  } else {
    this.chunks.push(op);
  }
};

Script.prototype._addOpcode = function(opcode, prepend) {
  var op;
  if (typeof opcode === 'number') {
    op = opcode;
  } else if (opcode.constructor && opcode.constructor.name && opcode.constructor.name === 'Opcode') {
    op = opcode.toNumber();
  } else {
    op = Opcode(opcode).toNumber();
  }
  this._insertAtPosition({
    opcodenum: op
  }, prepend);
  return this;
};

Script.prototype._addBuffer = function(buf, prepend) {
  var opcodenum;
  var len = buf.length;
  if (len === 0) {
    return;
  } else if (len > 0 && len < Opcode.OP_PUSHDATA1) {
    opcodenum = len;
  } else if (len < Math.pow(2, 8)) {
    opcodenum = Opcode.OP_PUSHDATA1;
  } else if (len < Math.pow(2, 16)) {
    opcodenum = Opcode.OP_PUSHDATA2;
  } else if (len < Math.pow(2, 32)) {
    opcodenum = Opcode.OP_PUSHDATA4;
  } else {
    throw new Error('You can\'t push that much data');
  }
  this._insertAtPosition({
    buf: buf,
    len: len,
    opcodenum: opcodenum
  }, prepend);
  return this;
};

Script.prototype.removeCodeseparators = function() {
  var chunks = [];
  for (var i = 0; i < this.chunks.length; i++) {
    if (this.chunks[i].opcodenum !== Opcode.OP_CODESEPARATOR) {
      chunks.push(this.chunks[i]);
    }
  }
  this.chunks = chunks;
  return this;
};

// high level script builder methods

/**
 * @returns a new Multisig output script for given public keys,
 * requiring m of those public keys to spend
 * @param {PublicKey[]} pubkeys - list of all public keys controlling the output
 * @param {number} m - amount of required signatures to spend the output
 * @param {Object} [opts] - Several options:
 *        - noSorting: defaults to false, if true, don't sort the given
 *                      public keys before creating the script
 */
Script.buildMultisigOut = function(pubkeys, m, opts) {
  opts = opts || {};
  var s = new Script();
  s.add(Opcode.smallInt(m));
  pubkeys = _.map(pubkeys, function(pubkey) { return PublicKey(pubkey); });
  var sorted = pubkeys;
  if (!opts.noSorting) {
    sorted = _.sortBy(pubkeys, function(pubkey) {
      return pubkey.toString('hex');
    });
  }
  for (var i = 0; i < sorted.length; i++) {
    var pubkey = sorted[i];
    s.add(pubkey.toBuffer());
  }
  s.add(Opcode.smallInt(pubkeys.length));
  s.add(Opcode.OP_CHECKMULTISIG);
  return s;
};

/**
 * A new P2SH Multisig input script for the given public keys, requiring m of those public keys to spend
 *
 * @param {PublicKey[]} pubkeys list of all public keys controlling the output
 * @param {number} threshold amount of required signatures to spend the output
 * @param {Array} signatures signatures to append to the script
 * @param {Object=} opts
 * @param {boolean=false} opts.noSorting don't sort the given public keys before creating the script
 * @param {Script=} opts.cachedMultisig don't recalculate the redeemScript
 *
 * @returns Script 
 */
Script.buildP2SHMultisigIn = function(pubkeys, threshold, signatures, opts) {
  opts = opts || {};
  var s = new Script();
  s.add(Opcode.OP_0);
  _.each(signatures, function(signature) {
    s.add(signature);
  });
  s.add((opts.cachedMultisig || Script.buildMultisigOut(pubkeys, threshold, opts)).toBuffer());
  return s;
};

/**
 * @returns a new pay to public key hash output for the given
 * address or public key
 * @param {(Address|PublicKey)} to - destination address or public key
 */
Script.buildPublicKeyHashOut = function(to) {
  if (to instanceof PublicKey) {
    to = to.toAddress();
  } else if (_.isString(to)) {
    to = new Address(to);
  }
  var s = new Script();
  s.add(Opcode.OP_DUP)
    .add(Opcode.OP_HASH160)
    .add(to.hashBuffer)
    .add(Opcode.OP_EQUALVERIFY)
    .add(Opcode.OP_CHECKSIG);
  return s;
};

/**
 * @returns a new pay to public key output for the given
 *  public key
 */
Script.buildPublicKeyOut = function(pubkey) {
  var s = new Script();
  s.add(pubkey.toBuffer())
    .add(Opcode.OP_CHECKSIG);
  return s;
};

/**
 * @returns a new OP_RETURN script with data
 * @param {(string|Buffer)} to - the data to embed in the output
 */
Script.buildDataOut = function(data) {
  if (typeof data === 'string') {
    data = new Buffer(data);
  }
  var s = new Script();
  s.add(Opcode.OP_RETURN)
    .add(data);
  return s;
};

/**
 * @param {Script} script - the redeemScript for the new p2sh output
 * @returns Script new pay to script hash script for given script
 */
Script.buildScriptHashOut = function(script) {
  var s = new Script();
  s.add(Opcode.OP_HASH160)
    .add(Hash.sha256ripemd160(script.toBuffer()))
    .add(Opcode.OP_EQUAL);
  return s;
};

/**
 * Builds a scriptSig (a script for an input) that signs a public key hash
 * output script.
 *
 * @param {Buffer|string|PublicKey} publicKey
 * @param {Buffer} signature - the signature in DER cannonical encoding
 * @param {number=1} sigtype - the type of the signature (defaults to SIGHASH_ALL)
 */
Script.buildPublicKeyHashIn = function(publicKey, signature, sigtype) {
  var script = new Script()
    .add(BufferUtil.concat([
      signature,
      BufferUtil.integerAsSingleByteBuffer(sigtype || Signature.SIGHASH_ALL)
    ]))
    .add(new PublicKey(publicKey).toBuffer());
  return script;
};

/**
 * @returns Script an empty script
 */
Script.empty = function() {
  return new Script();
};

/**
 * @returns Script a new pay to script hash script that pays to this script
 */
Script.prototype.toScriptHashOut = function() {
  return Script.buildScriptHashOut(this);
};

/**
 * @return Script a script built from the address
 */
Script.fromAddress = function(address) {
  address = Address(address);
  if (address.isPayToScriptHash()) {
    return Script.buildScriptHashOut(address);
  } else if (address.isPayToPublicKeyHash()) {
    return Script.buildPublicKeyHashOut(address);
  }
  throw new errors.Script.UnrecognizedAddress(address);
};

module.exports = Script;
