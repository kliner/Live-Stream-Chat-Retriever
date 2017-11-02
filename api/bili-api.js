#!/usr/bin/env node

var amqp = require('amqplib/callback_api');
var winston = require('winston');

var _config = null;
var _newMessages = [];
var _isReady = false;
var _lastHeartBeat = null;
var _heartBeatInterval = 30;

function initialize(config) {
  _config = config.live_data.bilibili;
  amqp.connect('amqp://localhost', function(err, conn) {
    conn.createChannel(function(err, ch) {
      var q = 'bilidm';

      ch.assertQueue(q, {durable: false});
      console.log(" [*] Waiting for messages in %s. To exit press CTRL+C", q);
      ch.consume(q, function(msg) {
        console.log(" [x] Received %s", msg.content.toString());
        _lastHeartBeat = new Date().getTime();
        if (!_isReady) { ready() }
        if (msg.content == 'heartBeat') { return; }
        var ct = JSON.parse(msg.content);
          
        var chatMessage = {
            type: 'chat',
            author: ct['user'],
            message: ct['text'],
            source: 'bili',
            date: new Date().getTime()
        };

        _newMessages.push(chatMessage);

      });
      ready();
    }, {noAck: true});
  });
}

function heartBeatCheck() {
    curdate = new Date().getTime();
    if (_lastHeartBeat == null || ((curdate - _lastHeartBeat) / 1000 > _heartBeatInterval)) {
        error();
    }
}

setInterval(heartBeatCheck, _heartBeatInterval * 1000);

function ready() {
    _isReady = true;
    winston.info('Bilibili API is ready to use');
    _newMessages.push({
        type: 'system',
        source: 'bili',
        date: new Date().getTime(),
        message: 'ready'
    });
}

function error() {
    _isReady = false;
    winston.info('Bilibili API error');
    _newMessages.push({
        type: 'system',
        source: 'bili',
        date: new Date().getTime(),
        message: 'error'
    });
}

function getNewMessages() {
  if (_newMessages.length == 0)
    return [];

  var newMessage = _newMessages;
  _newMessages = [];

  return newMessage;
}

exports.getNewMessages = getNewMessages;
exports.initialize = initialize;
