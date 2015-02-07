#!/usr/bin/env node

//variables
var http = require('http'),
	net = require('net'),
	readline = require('readline'),
	fs = require('fs'),
	util = require('util'),
	ircConnection = null,
	settings = require('./settings.json'),
	whoisIntervalLoop,
	ircBotWhoisHost = "",
	ircConnectionCompleted = false,
	ircConnectionCompletedCheckLoop;
var events = require("events");
var emitter = new events.EventEmitter();
var ircRelayServerEmitter = new events.EventEmitter(); ircRelayServerEmitter.setMaxListeners(0);
var sys = require('sys')
var exec = require('child_process').exec;

//handle wierd errors
process.on('uncaughtException', function (err) {
	console.log(err);
});

//handle terminal input
process.stdin.setEncoding('utf8');


process.stdin.on('readable', function() {
	var chunk = process.stdin.read();
	if (chunk !== null) {
		if ((commandArgsRaw = new RegExp('/raw ([^\r\n]*)', 'g').exec(chunk)) != null) {
			ircConnection.write(commandArgsRaw[1]+'\r\n');
		}else if ((commandArgsJoin = new RegExp('/join (#[^\r\n]*)', 'g').exec(chunk)) != null) {
			settings.channels.splice(settings.channels.lastIndexOf(settings.channels.slice(-1)[0])+1, 0, commandArgsJoin[1]);
		}else if ((commandArgsPart = new RegExp('/part (#[^ \r\n]*)(?: ([^\r\n]*)+){0,1}', 'g').exec(chunk)) != null) {
			var partReason = "Leaving";
			if (commandArgsPart[2] != null) {partReason=commandArgsPart[2]}
			settings.channels.splice(settings.channels.lastIndexOf(commandArgsPart[1]), 1);
			ircConnection.write('PART '+commandArgsPart[1]+' :'+partReason+'\r\n');
		}else if ((commandArgsChannel = new RegExp('(#[^ \r\n]*)+ ([^\r\n]*)*', 'g').exec(chunk)) != null) {
			ircConnection.write('PRIVMSG '+commandArgsChannel[1]+' :'+commandArgsChannel[2]+'\r\n');
		}else if ((commandArgsQuit = new RegExp('/quit(?: ([^\r\n]*)){0,1}', 'g').exec(chunk)) != null) {
			var quitReason = commandArgsQuit[1]||"Leaving";
			ircConnection.write('QUIT :'+quitReason+'\r\n');
			console.log('quiting...');
			setTimeout(function () {ircConnection.end();ircConnection.destroy();process.exit();}, 1000);
		}else{
			ircConnection.write('PRIVMSG '+settings.channels[0]+' :'+chunk+'\r\n');
		}
	}
});

//misc prototypes
Array.prototype.diff = function(a) {
	return this.filter(function(i) {return a.indexOf(i) < 0;});
};

String.prototype.replaceSpecialChars = function(a) {
	return this.replace(/#c(?!si)/g, '\x03').replace(/#csi/g, '\x1B[').replace(new RegExp('#x([0-9a-fA-F]{2})', 'g'), function(regex, hex){return eval('"\\x'+hex+'"');});
};

//misc functions

//misc functions: parse whois for channels
function whoisParseChannels(data) {
	var channels = new RegExp('('+data[1]+' :([^# \r\n]*#([^ \r\n]+) )+(\r\n)+(?:[^]*(?='+data[1]+' :([^# \r\n]*#([^ \r\n]+) )*(\r\n)*)))+').exec(data[0]),
		channelRegexp = new RegExp('[^#]*([^ ]*) ', 'g'),
		result,
		userChannels = [],
		userChannelsC = 0;
	if (channels != null) {
		while ((result = channelRegexp.exec(channels[0])) !== null) {userChannels[userChannelsC] = result[1];userChannelsC++};
	}
	return [userChannels, userChannelsC];
}

//misc functions: irc relay
function ircRelayMessageHandle(c) {
	ircRelayServerEmitter.once('newIrcMessage', function (from, to, message) {
		if (c.writable) {
			c.write(from+':'+to+':'+message+'\r\n');
			ircRelayMessageHandle(c);
		}
	});
}

function ircRelayServer(){
	var server = net.createServer(function(c) { //'connection' listener
		console.log('client connected to irc relay');
		c.on('end', function() {
			console.log('client disconnected from irc relay');
		});
		ircRelayMessageHandle(c);
	});
	server.listen(settings.ircRelayServerPort, function() { //'listening' listener
		console.log('irc relay server bound!');
	});
}

//misc functions: ping the server by connecting and quickly closing
function pingTcpServer(host, port, callback){
	function returnResults(data) {callback(data);}
	pingHost = net.connect({port: port, host: host}, function () {
		returnResults(true);
		pingHost.end();pingHost.destroy();
	});
	pingHost.on('error', function () {pingHost.end();pingHost.destroy();returnResults(false);});
}

//misc functions: join missing channels
function ircJoinMissingChannels() {
	sendCommandWHOIS(settings.botName, function(data){
		var channelArray=whoisParseChannels(data);
		var missingChannels=settings.channels.diff(channelArray[0]);
		for (channel in missingChannels){
			if(settings.channels.hasOwnProperty(channel)){
				console.log("joining channel: "+missingChannels[channel]);
				ircConnection.write('JOIN '+missingChannels[channel]+'\r\n')
			}
			
		}
		
	})
}

//misc functions: return help
function ircSendHelpToUser(user) {
	sendCommandPRIVMSG('.hug: gives you a free hug\n\
.whereami: tells you where you are\n\
.isup starbound: checks if my starbound server on mindcraft.si.eu.org is up\n\
.echo "string": prints string back to the chat\n\
.sendmsg "#channel" "string": prints string on the channel (only if the bot is in it)\n\
.view "url": prints the data located at the url, data must not be bigger than 1KB\n\
.ping "host" "port": pings the port on host\n\
.nbot: prints some info about nBot\n\
.help: prints this message\n\
.away: prints a list of away users in the channel', user);
}

//misc functions: get random img from mylittlefacewhen.com
function getRandomLittleFace(channel) {
	function getAcceptedImage(max, channel) {
		var tryImgN = getRandomInt(1, max);
		http.get('http://mylittlefacewhen.com/api/v3/face/?offset='+tryImgN+'&limit=1&format=json', function(res) {
			res.on('data', function (chunk) {
				var imgData = JSON.parse(chunk);
				if (imgData.objects[0].accepted){
					var description = new RegExp('(.*)(?= reacting with) reacting with \'(.*)(?=\',)').exec(imgData.objects[0].description);
					sendCommandPRIVMSG('Random mylittlefacewhen.com image: http://mylittlefacewhen.com/f/'+imgData.objects[0].id+' "'+description[1]+": "+description[2]+'"', channel);
				}else if (imgData.objects[0].accepted == false){getAcceptedImage(max, channel);};
			});
		}).on('error', function(e) {sendCommandPRIVMSG("Got error: "+e.message, channel);});
	}
	http.get('http://mylittlefacewhen.com/api/v3/face/?offset=1&limit=1&format=json', function(res) {
		res.on('data', function (chunk) {
			getAcceptedImage((JSON.parse(chunk).meta.total_count)-1, channel);
		});
	}).on('error', function(e) {sendCommandPRIVMSG("Got error: "+e.message, channel);});
}

//misc functions: get random int
function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

//misc functions: radio status
function printRadioStatus(channel) {
	var currentsong, listeners;
	function getRadioStatus() {
		function getCurrentSong() {
				var mpdConnection = net.connect({port: settings.radioStatus_mpdServerPort, host: settings.radioStatus_mpdServer},
					function() { //'connect' listener
						mpdConnection.setEncoding('utf8');
						mpdConnection.write('currentsong\n');
						mpdConnection.on('data', function (data) {
							if (data == new RegExp('OK MPD [^\n]*\n').exec(data)){
								//nothing
							}else{
								currentsong=data;
								mpdConnection.end();mpdConnection.destroy();
								getRadioStatus();
							};
						});
				});
				mpdConnection.setTimeout(10000);
				mpdConnection.on('error', function (e) {mpdConnection.end();mpdConnection.destroy();sendCommandPRIVMSG("Got error: "+e.message, channel);});
				mpdConnection.on('timeout', function (e) {mpdConnection.end();mpdConnection.destroy();;sendCommandPRIVMSG("Got error: Connection Timeout", channel);});
		};
		function getListeners() {
			http.get(settings.radioStatus_icecastStatsUrl, function(res) {
				res.setEncoding('utf8');
				res.on('data', function (chunk) {
					listeners=JSON.parse(chunk).icestats.source.listeners;
					getRadioStatus();
				});
			}).on('error', function(e) {sendCommandPRIVMSG("Got error: "+e.message, channel);});
		}
		if (currentsong == null) {
			getCurrentSong();
		}else if (listeners == null) {
			getListeners();
		}else {
			var RegExCurrentSong=new RegExp('file: .*?(?=[^/\n]+\n)([^/\n]+)\n').exec(currentsong);
			sendCommandPRIVMSG('Now Playing: '+RegExCurrentSong[1].replace(/\.[^.]*$/, '')+' | Listeners: '+listeners+' | Tune in at http://radio.mindcraft.si.eu.org/stream (dont it sucks)', channel);
		}
	}
	getRadioStatus();
}

//irc command functions
function sendCommandPRIVMSG(data, to, timeout){
	var privmsgLenght = 512-(":"+settings.botName+"!"+ircBotWhoisHost[1]+"@"+ircBotWhoisHost[2]+" "+to+" :\r\n").length
	var dataLengthRegExp = new RegExp('.{1,'+privmsgLenght+'}', 'g'), stringArray = [], c = 0, timeout=timeout||1000;
	function writeData(data, to, c, timeout) {
		setTimeout(function() {ircConnection.write('PRIVMSG '+to+' :'+data[c]+'\r\n'); c++; if (data[c] != null) {writeData(data, to, c, timeout)}; }, timeout)
	}
	while ((string = dataLengthRegExp.exec(data)) !== null) {
		stringArray[c]=string[0];c++
	}
	if (c <= 1){timeout=0};
	writeData(stringArray, to, 0, timeout);
}

function sendCommandWHOIS(user, callback) {
	ircConnection.write('WHOIS '+user+'\r\n');
	function handleresponseWHOISEvent(user) {
		emitter.once('responseWHOIS', function (data) {
			if (data[1] == user) {
				if (callback != null) {callback(data);}
			}else{handleresponseWHOISEvent(user);}
		});
	}
	handleresponseWHOISEvent(user);
}

function sendCommandWHO(channel, callback) {
	ircConnection.write('WHO '+channel+'\r\n');
	function handleresponseWHOEvent(channel) {
		emitter.once('responseWHO', function (data) {
			if (data[1] == channel) {
				if (callback != null) {callback(data);}
			}else{handleresponseWHOEvent(channel);}
		});
	}
	handleresponseWHOEvent(channel);
}

//irc command handle functions
function responseHandlePRIVMSG(data) {
	ircRelayServerEmitter.emit('newIrcMessage', data[1], data[2], data[3]);
	console.log('['+data[2]+'] '+data[1]+': '+data[3]);
	var ircMessageARGS = {}, ircMessageARGC = 0, ircMessageARG, ircMessageARGRegex = new RegExp('(?:(?:(?:")+([^"]+)(?:")+)+|([^ ]+)+)+(?: )*', 'g');
	while ((ircMessageARG = ircMessageARGRegex.exec(data[3])) !== null) {if(ircMessageARG[1] != null){ircMessageARGS[ircMessageARGC]=ircMessageARG[1];}else{ircMessageARGS[ircMessageARGC]=ircMessageARG[2];}ircMessageARGC++};
	if (data[3] == ".hug") {sendCommandPRIVMSG('*Hugs '+data[1]+'*', data[2]);};
	if (data[3] == ".whereami") {sendCommandPRIVMSG('wrong side of the internet', data[2]);};
	if ((commandArgsWhereis = new RegExp('^.where(?:.*)*?(?=is)is ([^ ]*)', 'g').exec(data[3])) != null) {var originChannel = data[2];sendCommandWHOIS(commandArgsWhereis[1], function(data){var channelArray=whoisParseChannels(data), channels=""; for (channel in channelArray[0]){if(channelArray[0].hasOwnProperty(channel)){channels=channels+channelArray[0][channel]+' '}};sendCommandPRIVMSG(data[1]+' is on: '+channels.replace(/^$/, 'User not found on any channel'), originChannel);});};
	if (new RegExp('(Hi|Hello) '+settings.botName, 'gi').exec(data[3]) != null) {sendCommandPRIVMSG('Hi '+data[1], data[2]);};
	if (data[3] == ".isup starbound") {exec("nmap mindcraft.si.eu.org -p 21025", function(error, stdout, stderr){if (RegExp('open', 'g').exec(stdout) != null) {sendCommandPRIVMSG('starbound server is up', data[2]);}else{sendCommandPRIVMSG('starbound server is down', data[2]);};});};
	if (ircMessageARGS[0] == ".echo") {sendCommandPRIVMSG(ircMessageARGS[1].replaceSpecialChars(), data[2]);};
	if (new RegExp('(?:.channelmsg|.cmsg|.chanmsg|.sendmsg)', 'gi').exec(ircMessageARGS[0])) {sendCommandPRIVMSG(ircMessageARGS[2].replaceSpecialChars(), ircMessageARGS[1]);};
	if (ircMessageARGS[0] == ".view") {http.get(ircMessageARGS[1], function(res) {res.on('data', function (chunk) {if(chunk.length < settings.command_request_maxBytes){sendCommandPRIVMSG(chunk, data[2]);}});}).on('error', function(e) {sendCommandPRIVMSG("Got error: "+e.message, data[2]);});};
	if (ircMessageARGS[0] == ".ping") {pingTcpServer(ircMessageARGS[1], ircMessageARGS[2], function (status) {var statusString; if(status){statusString="open"}else{statusString="closed"}sendCommandPRIVMSG("Port "+ircMessageARGS[2]+" on "+ircMessageARGS[1]+" is: "+statusString, data[2]);});};
	if (ircMessageARGS[0] == ".nbot") {sendCommandPRIVMSG("I'm a random bot writen for fun, you can see my code here: http://mindcraft.si.eu.org/git/?p=nBot.git", data[2]);};
	if (ircMessageARGS[0] == ".help") {ircSendHelpToUser(data[1]);};
	if (ircMessageARGS[0] == ".away") {var originChannel = data[2];sendCommandWHO(data[2], function (data) {var ircGoneUsersRegex = new RegExp('([^ \r\n]+){1} G', 'g'), ircGoneUsersString = "", ircGoneUser; while((ircGoneUser = ircGoneUsersRegex.exec(data[0])) != null){ircGoneUsersString=ircGoneUsersString+ircGoneUser[1]+", ";};sendCommandPRIVMSG("Away users are: "+ircGoneUsersString.replace(/, $/, ".").replace(/^$/, 'No users are away'), originChannel);});};
	if (ircMessageARGS[0] == ".randomlittleface") {getRandomLittleFace(data[2]);};
	if (RegExp('(?:djazz|nnnn20430|IcyDiamond)', 'gi').exec(data[1]) && new RegExp('(?:home time|home tiem)', 'gi').exec(data[3])) {sendCommandPRIVMSG('WOO HOME TIME!!!', data[2]);};
	if (ircMessageARGS[0] == ".np") {printRadioStatus(data[2]);};
}

function responseHandleWHOIS(data) {
	if (data[1] == settings.botName) { ircBotWhoisHost = new RegExp(data[1]+' ([^ \r\n]+) ([^ *\r\n]+) \\*').exec(data[0]) };
	emitter.emit('responseWHOIS', data);
}

function responseHandleWHO(data) {
	emitter.emit('responseWHO', data);
}

function responseHandleJOIN(data) {
	if (data[1] != settings.botName){
		sendCommandPRIVMSG('Hi '+data[1], data[4]);
		if(data[3] == "Pony-jq9.9a2.149.49.IP"){sendCommandPRIVMSG('oh great its the same hostname as that Cindy girl "Pony-jq9.9a2.149.49.IP"', data[4]);};
		if(data[1] == "nnnn20430"){sendCommandPRIVMSG('My Creator is back !!!', data[4]);};
	};
}

//main irc data receiving function
function ircDataReceiveHandle(data, ircConnection) {
	//console.log(data);
	var ircMessageLines = {}, ircMessageLineC = 0, ircMessageLine, ircMessageLineRegex = new RegExp('([^\r\n]+)', 'g');
	while ((ircMessageLine = ircMessageLineRegex.exec(data)) !== null) {ircMessageLines[ircMessageLineC]=ircMessageLine[1];ircMessageLineC++};
	for (line in ircMessageLines) {
		line=ircMessageLines[line];
		//parse single lines here
		var ircPRIVMSG = new RegExp(':([^! \r\n]+)![^@ \r\n]+@[^ \r\n]+ PRIVMSG (#[^ \r\n]+) :([^\r\n]*)', 'g').exec(line); if (ircPRIVMSG != null){responseHandlePRIVMSG(ircPRIVMSG);};
		var ircJOIN = new RegExp(':([^! \r\n]+)!([^@ \r\n]+)@([^ \r\n]+) JOIN :(#[^ \r\n]*)', 'g').exec(line); if (ircJOIN != null){responseHandleJOIN(ircJOIN);};
	}
	//parse whole response here
	var ircWHOISRegex = new RegExp('311 (?:[^ \r\n]* ){0,1}([^ \r\n]+) (?:[^ \r\n]+ ){2}(?=\\*)\\* :[^\r\n]*(\r\n:[^\r\n]*)+?(?=:End of \\/WHOIS list):End of \\/WHOIS list', 'g'),
		ircWHORegex = new RegExp('352 (?:[^ \r\n]* ){0,1}([^ \r\n]+) (?:[^ \r\n]+ ){3}(?=[^ \r\n]+ (?:H|G)+)([^ \r\n]+) (?:H|G){1}(?:\\*){0,1}(?:@|\\+){0,1} :[^\r\n]*(\r\n:[^\r\n]*)+?(?=:End of \\/WHO list):End of \\/WHO list', 'g');
	while ((ircWHOIS = ircWHOISRegex.exec(data)) !== null) {if (ircWHOIS != null){responseHandleWHOIS(ircWHOIS);};};
	while ((ircWHO = ircWHORegex.exec(data)) !== null) {if (ircWHO != null){responseHandleWHO(ircWHO);};};
}

//starts the bot
function initIrc() {
	ircConnection = net.connect({port: settings.ircServerPort, host: settings.ircServer},
		function() { //'connect' listener
			console.log('connected to irc server!');
			ircConnection.setEncoding('utf8');
			ircConnection.on('data', function(chunk) { if(chunk.match(/PING :([^\r\n]*)/) != null){ircConnection.write('PONG :'+chunk.match(/PING :([^\r\n]*)/)[1]+'\r\n')}else{ircDataReceiveHandle(chunk, ircConnection);};});
			if (settings.ircServerPassword != "") {ircConnection.write('PASS '+settings.ircServerPassword+'\r\n');};
			ircConnection.write('NICK '+settings.botName+'\r\n');
			ircConnection.write('USER '+settings.botName+' '+settings.hostName+' '+settings.ircServer+' :'+settings.botName+'\r\n');
			console.log('waiting for server to complete connection initialization');
			ircConnectionCompletedCheckLoop = setInterval(function () {if(!ircConnectionCompleted){sendCommandWHOIS(settings.botName, function(data) {if(data != null){ircConnectionCompleted=true;};});}else{clearInterval(ircConnectionCompletedCheckLoop);console.log('joining channels...');whoisIntervalLoop = setInterval(function () {ircJoinMissingChannels();}, 5000);};}, 5000);
	});
	ircConnection.setTimeout(15000);
	ircConnection.on('error', function (e) {ircConnection.end();ircConnection.destroy();console.log("Got error: "+e.message);});
	ircConnection.on('timeout', function (e) {ircConnection.end();ircConnection.destroy();console.log('connection timeout');});
	ircConnection.on('close', function() {if(ircConnectionCompleted){clearInterval(whoisIntervalLoop);}else{clearInterval(ircConnectionCompletedCheckLoop);}; setTimeout(function() {initIrc();}, 3000);});
}

if(settings.ircRelayServerEnabled){ircRelayServer();};
initIrc();
