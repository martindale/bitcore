'use strict';

var _ = require('lodash');
var errors = require('../../errors');
var BufferWriter = require('../../encoding/bufferwriter');
var buffer = require('buffer');
var bufferUtil = require('../../util/buffer');
var JSUtil = require('../../util/js');
var Script = require('../../script');
var Sighash = require('../sighash');

function Input(params) {
  if (!(this instanceof Input)) {
    return new Input(params);
  }
  if (params) {
    return this._fromObject(params);
  }
}

Object.defineProperty(Input.prototype, 'script', {
  configurable: false,
  writeable: false,
  get: function() {
    if (!this._script) {
      this._script = new Script(this._scriptBuffer);
    }
    return this._script;
  }
});

Input.prototype._fromObject = function(params) {
  if (_.isString(params.prevTxId) && JSUtil.isHexa(params.prevTxId)) {
    params.prevTxId = new buffer.Buffer(params.prevTxId, 'hex');
  }
  this.output = params.output;
  this.prevTxId = params.prevTxId;
  this.outputIndex = params.outputIndex;
  this.sequenceNumber = params.sequenceNumber;
  if (params.script || params.scriptBuffer) {
    this.setScript(params.script || params.scriptBuffer);
  }
  return this;
};

Input.prototype.toObject = function toObject() {
  return {
    prevTxId: this.prevTxId.toString('hex'),
    outputIndex: this.outputIndex,
    sequenceNumber: this.sequenceNumber,
    script: this._script.toString()
  };
};

Input.prototype.toJSON = function toJSON() {
  return JSON.stringify(this.toObject());
};

Input.fromJSON = function(json) {
  if (JSUtil.isValidJSON(json)) {
    json = JSON.parse(json);
  }
  return new Input({
    prevTxId: json.prevTxId || json.txidbuf,
    outputIndex: _.isUndefined(json.outputIndex) ? json.txoutnum : json.outputIndex,
    sequenceNumber: json.sequenceNumber || json.seqnum,
    scriptBuffer: new Script(json.script, 'hex')
  });
};

Input.fromBufferReader = function(br) {
  var input = new Input();
  input.prevTxId = br.readReverse(32);
  input.outputIndex = br.readUInt32LE();
  var scriptSize = br.readVarintNum();
  if (scriptSize) {
    input._scriptBuffer = br.read(scriptSize);
  } else {
    input._scriptBuffer = new buffer.Buffer([]);
  }
  input.sequenceNumber = br.readUInt32LE();
  return input;
};

Input.prototype.toBufferWriter = function(writer) {
  if (!writer) {
    writer = new BufferWriter();
  }
  writer.writeReverse(this.prevTxId);
  writer.writeUInt32LE(this.outputIndex);
  var script = this._scriptBuffer;
  writer.writeVarintNum(script.length);
  writer.write(script);
  writer.writeUInt32LE(this.sequenceNumber);
  return writer;
};

Input.prototype.setScript = function(script) {
  if (script instanceof Script) {
    this._script = script;
    this._scriptBuffer = script.toBuffer();
  } else if (bufferUtil.isBuffer(script)) {
    this._script = null;
    this._scriptBuffer = new buffer.Buffer(script);
  } else {
    console.log(script);
    throw new TypeError('Invalid Argument');
  }
  return this;
};

/**
 * Retrieve signatures for the provided PrivateKey.
 *
 * @param {Transaction} transaction - the transaction to be signed
 * @param {PrivateKey} privateKey - the private key to use when signing
 * @param {number} inputIndex - the index of this input in the provided transaction
 * @param {number} sigType - defaults to Signature.SIGHASH_ALL
 * @param {Buffer} addressHash - if provided, don't calculate the hash of the
 *     public key associated with the private key provided
 * @abstract
 */
Input.prototype.getSignatures = function() {
  throw new errors.AbstractMethodInvoked('Input#getSignatures');
};

Input.prototype.isFullySigned = function() {
  throw new errors.AbstractMethodInvoked('Input#isFullySigned');
};

Input.prototype.addSignature = function() {
  throw new errors.AbstractMethodInvoked('Input#addSignature');
};

Input.prototype.isValidSignature = function(transaction, signature) {
  // FIXME: Refactor signature so this is not necessary
  signature.signature.nhashtype = signature.sigtype;
  return Sighash.verify(
      transaction,
      signature.signature,
      signature.publicKey,
      signature.inputIndex,
      this.output.script
  );
};

module.exports = Input;
