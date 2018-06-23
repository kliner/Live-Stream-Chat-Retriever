var http = require('http');
var express = require('express');
var socketio = require('socket.io');
var async = require('async');
var fs = require('fs');
var path = require('path');
var mkdirp = require('mkdirp');
var winston = require('winston');
var ipfilter = require('express-ipfilter');
const bodyParser = require("body-parser");

// Setup the logger
winston.addColors({
    debug: 'green',
    info: 'cyan',
    silly: 'magenta',
    warn:  'yellow',
    error: 'red'
});

winston.add(winston.transports.File, { 
    name: 'info', 
    filename: './logs/info.log', 
    level: 'info',
    colorize: true
});

winston.add(winston.transports.File, { 
    name: 'error', 
    filename: './logs/error.log', 
    level: 'error',
    colorize: true 
});

var youtubeApi = require('./api/youtube-api');
var twitchApi = require('./api/twitch-api');
var hitboxApi = require('./api/hitbox-api');
var beamApi = require('./api/beam-api');
var dailymotionApi = require('./api/dailymotion-api');

var chatMessageId = 0;
var chatMessages = [];
var systemMessages = [];
var maxMessagesStored = 100;

function run(config) {
    // Initialize all APIs
    if (config.live_data.youtube.enabled)
        youtubeApi.initialize(config);

    if (config.live_data.twitch.enabled)
        twitchApi.initialize(config);

    if (config.live_data.hitbox.enabled)
        hitboxApi.initialize(config);

    if (config.live_data.beam.enabled)
        beamApi.initialize(config);

    if (config.live_data.dailymotion.enabled)
        dailymotionApi.initialize(config);

    var app = express();
    app.use(express.static('public'));
    //app.use(ipfilter(config.whitelisted_ips, {
    //    mode: 'allow',
    //    logF: winston.info
    //}));
    app.use(bodyParser.urlencoded({
        extended: true
    }));


    var server = http.Server(app);
    var io = socketio(server);

    io.on('connection', function(socket) {
        winston.info('Someone has connected to the chat');
        socket.emit('connected');

        // Send only the last 10 messages
        chatMessagesToSend = chatMessages.slice(Math.max(chatMessages.length - 10, 0));
        io.emit('oldChatMessages', chatMessagesToSend);                

        // Send system messages
        io.emit('oldSystemMessages', systemMessages);                
    });

    app.get('/', function(req, res) {
        res.sendFile(path.join(__dirname, '/public/chat.html'));
    });

    app.get('/msg', function(req, res) {
      res.send("<form method='post'><input name='s' value='bili' type='hidden'/><input name='user' value='a' type='hidden'/><input name='text'/><input type='submit'/></form>");
    });

    app.post('/msg', function(req, res) {
        console.log(" [x] Received request %s", req.body.text);

        var chatMessage = {
            type: 'chat',
            author: req.body['user'],
            message: req.body['text'],
            source: req.body['s'],
            date: new Date().getTime()
        };

        newMessages.push(chatMessage);
      res.send("<form method='post'><input name='s' value='bili' type='hidden'/><input name='user' value='a' type='hidden'/><input name='text'/><input type='submit'/></form>");
      //res.send("OK");

    });


    if (config.live_data.youtube.enabled && config.live_data.youtube.redirect_url) {
        app.get(config.live_data.youtube.redirect_url, function(req, res){
          youtubeApi.getToken(req.query.code);
          res.redirect('/');
        });
    }

    server.listen(config.port, function() {
        winston.info('listening on *: ' + config.port);
    });

    // Retrieve new messages
    var newMessages = [];
    async.forever(
        function(next) {

            if (config.live_data.youtube.enabled) {
                youtubeApi.getNewMessages().forEach(function(elt) { 
                    newMessages.push(elt); 
                });
            }

            if (config.live_data.twitch.enabled && twitchApi.isReady()) {
                twitchApi.getNewMessages().forEach(function(elt) { 
                    newMessages.push(elt); 
                });
            }

            if (config.live_data.hitbox.enabled && hitboxApi.isReady()) {
                hitboxApi.getNewMessages().forEach(function(elt) { 
                    newMessages.push(elt); 
                });
            }

            if (config.live_data.beam.enabled && beamApi.isReady()) {
                beamApi.getNewMessages().forEach(function(elt) { 
                    newMessages.push(elt); 
                });
            }

            if (config.live_data.dailymotion.enabled && dailymotionApi.isReady()) {
                dailymotionApi.getNewMessages().forEach(function(elt) { 
                    newMessages.push(elt); 
                });
            }

            if (newMessages.length > 0)
            {
                winston.info(newMessages);

                newMessages.forEach(function(elt) {
                    if (elt.type == 'chat') {
                        // Affect a unique id to each message
                        elt.id = chatMessageId;
                        chatMessageId++;

                        chatMessages.push(elt);

                        // Make sure to keep less than the maximum allowed
                        if (chatMessages.length > maxMessagesStored)
                            chatMessages.shift();

                        io.emit('newChatMessage', elt);
                    }
                    else if (elt.type == 'system') {
                        systemMessages.push(elt);

                        if (systemMessages.length > maxMessagesStored)
                            systemMessages.shift();

                        io.emit('newSystemMessage', elt);
                    }        
                });

                newMessages = [];
            }

            setTimeout(next, 1000);
        },
        function(err) {
            winston.error('Error retrieving new messages: ' + err);
        }
    );

}

// Create a new directory for log files
mkdirp('./logs', function(err) {
    if (err) 
        winston.error('Unable to create the log folder', err);
});

// Load config file
fs.readFile('config.json', function (err, config) {
    if (err) {
        winston.error('Error loading config file: ' + err);
        return;
    }

    config = JSON.parse(config);

    if (!config.host || !config.port) {
        winston.error('Error loading config file: host or port is missing!');
        return;
    }

    run(config);
});
