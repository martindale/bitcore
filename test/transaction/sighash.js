'use strict';

var buffer = require('buffer');
var bufferUtil = require('../../lib/util/buffer');

var Script = require('../../lib/script');
var Signature = require('../../lib/crypto/signature');
var Transaction = require('../../lib/transaction');
var sighash = require('../../lib/transaction/sighash');

var vectors_sighash = require('./sighash.json');

describe('sighash', function() {

  it('test vector from bitcoind', function() {
    vectors_sighash.forEach(function(vector, i) {
      if (i === 0) {
        // First element is just a row describing the next ones
        return;
      }
      var txbuf = new buffer.Buffer(vector[0], 'hex');
      var scriptbuf = new buffer.Buffer(vector[1], 'hex');
      var subscript = Script(scriptbuf);
      var nin = vector[2];
      var nhashtype = vector[3];
      var sighashbuf = new buffer.Buffer(vector[4], 'hex');
      var tx = new Transaction(txbuf);

      //make sure transacion to/from buffer is isomorphic
      tx.serialize().should.equal(txbuf.toString('hex'));

      //sighash ought to be correct
      sighash.sighash(tx, nhashtype, nin, subscript).toString('hex').should.equal(sighashbuf.toString('hex'));
    });
  });
});
