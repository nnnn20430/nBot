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
			setTimeout(function () {ircConnection.end();ircConnection.destroy();process.exit();}, 3000);
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

//irc command functions
function sendCommandPRIVMSG(data, channel, timeout){
	var privmsgLenght = 512-(":"+settings.botName+"!"+ircBotWhoisHost[1]+"@"+ircBotWhoisHost[2]+" "+channel+" :\r\n").length
	var dataLengthRegExp = new RegExp('.{1,'+privmsgLenght+'}', 'g'), stringArray = [], c = 0, timeout=timeout||1000;
	function writeData(data, channel, c, timeout) {
		setTimeout(function() {ircConnection.write('PRIVMSG '+channel+' :'+data[c]+'\r\n'); c++; if (data[c] != null) {writeData(data, channel, c, timeout)}; }, timeout)
	}
	while ((string = dataLengthRegExp.exec(data)) !== null) {
		stringArray[c]=string[0];c++
	}
	if (c <= 1){timeout=0};
	writeData(stringArray, channel, 0, timeout);
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

//irc command handle functions
function responseHandlePRIVMSG(data) {
	ircRelayServerEmitter.emit('newIrcMessage', data[1], data[2], data[3]);
	console.log('['+data[2]+'] '+data[1]+': '+data[3]);
	var ircMessageARGS = {}, ircMessageARGC = 0, ircMessageARG, ircMessageARGRegex = new RegExp('(?:(?:(?:")+([^"]+)(?:")+)+|([^ ]+)+)+(?: )*', 'g');
	while ((ircMessageARG = ircMessageARGRegex.exec(data[3])) !== null) {if(ircMessageARG[1] != null){ircMessageARGS[ircMessageARGC]=ircMessageARG[1];}else{ircMessageARGS[ircMessageARGC]=ircMessageARG[2];}ircMessageARGC++};
	if (data[3] == ".hug") {sendCommandPRIVMSG('*Hugs '+data[1]+'*', data[2]);};
	if (data[3] == ".whereami") {sendCommandPRIVMSG('wrong side of the internet', data[2]);};
	if ((commandArgsWhereis = new RegExp('^.where(?:.*)*?(?=is)is ([^ ]*)', 'g').exec(data[3])) != null) {var originChannel = data[2];sendCommandWHOIS(commandArgsWhereis[1], function(data){var channelArray=whoisParseChannels(data), channels=""; for (channel in channelArray[0]){if(channelArray[0].hasOwnProperty(channel)){channels=channels+channelArray[0][channel]+' '}};sendCommandPRIVMSG(data[1]+' is on '+channels, originChannel);});};
	if (new RegExp('(Hi|Hello) '+settings.botName, 'gi').exec(data[3]) != null) {sendCommandPRIVMSG('Hi '+data[1], data[2]);};
	if (data[3] == ".isup starbound") {exec("nmap mindcraft.si.eu.org -p 21025", function(error, stdout, stderr){if (RegExp('open', 'g').exec(stdout) != null) {sendCommandPRIVMSG('starbound server is up', data[2]);}else{sendCommandPRIVMSG('starbound server is down', data[2]);};});};
	if (ircMessageARGS[0] == ".echo") {sendCommandPRIVMSG(ircMessageARGS[1].replaceSpecialChars(), data[2]);};
	if (new RegExp('(?:.channelmsg|.cmsg|.chanmsg|.sendmsg)', 'gi').exec(ircMessageARGS[0])) {sendCommandPRIVMSG(ircMessageARGS[2].replaceSpecialChars(), ircMessageARGS[1]);};
	if (ircMessageARGS[0] == ".request") {http.get(ircMessageARGS[1], function(res) {res.on('data', function (chunk) {if(chunk.length < settings.command_request_maxBytes){sendCommandPRIVMSG(chunk, data[2]);}});}).on('error', function(e) {sendCommandPRIVMSG("Got error: "+e.message, data[2]);});};
	if (ircMessageARGS[0] == ".ping") {pingTcpServer(ircMessageARGS[1], ircMessageARGS[2], function (status) {var statusString; if(status){statusString="open"}else{statusString="closed"}sendCommandPRIVMSG("Port "+ircMessageARGS[2]+" on "+ircMessageARGS[1]+" is: "+statusString, data[2]);});};
	if (ircMessageARGS[0] == ".nbot") {sendCommandPRIVMSG("I'm a random bot writen for fun, you can see my code here: http://mindcraft.si.eu.org/git/?p=nBot.git", data[2]);};
}

function responseHandleWHOIS(data) {
	if (data[1] == settings.botName) { ircBotWhoisHost = new RegExp(data[1]+' ([^ \r\n]+) ([^ *\r\n]+) \\*').exec(data[0]) };
	emitter.emit('responseWHOIS', data);
}

function responseHandleJOIN(data) {
	if (data[1] != settings.botName){sendCommandPRIVMSG('Hi '+data[1], data[2]);};
}

//main irc data receiving function
function ircDataReceiveHandle(data, ircConnection) {
	//console.log(data);
	var ircWHOIS = new RegExp('311 [^ \r\n]* ([^ \r\n]+) (?:[^ \r\n]+ ){2}(?=\\*)\\* :[^\r\n]*(\r\n:[^\r\n]*)+?(?=:End of /WHOIS list):End of /WHOIS list', 'g').exec(data);
	var ircPRIVMSG = new RegExp(':([^! \r\n]+)![^@ \r\n]+@[^ \r\n]+ PRIVMSG (#[^ \r\n]+) :([^\r\n]*)', 'g').exec(data);
	var ircJOIN = new RegExp(':([^! \r\n]+)![^@ \r\n]+@[^ \r\n]+ JOIN :(#[^ \r\n]+)', 'g').exec(data);
	if (ircWHOIS != null){responseHandleWHOIS(ircWHOIS);};
	if (ircPRIVMSG != null){responseHandlePRIVMSG(ircPRIVMSG);};
	if (ircJOIN != null){responseHandleJOIN(ircJOIN);};
}

//starts the bot
function initIrc() {
	ircConnection = net.connect({port: settings.ircServerPort, host: settings.ircServer},
		function() { //'connect' listener
			console.log('connected to irc server!');
			ircConnection.setEncoding('utf8');
			ircConnection.on('data', function(chunk) { if(chunk.match(/PING :([^\r\n]*)/) != null){ircConnection.write('PONG :'+chunk.match(/PING :([^\r\n]*)/)[1]+'\r\n')}else{ircDataReceiveHandle(chunk, ircConnection);};});
			ircConnection.write('NICK '+settings.botName+'\r\n');
			ircConnection.write('USER '+settings.botName+' '+settings.hostName+' '+settings.ircServer+' :'+settings.botName+'\r\n');
			console.log('waiting for server to complete connection initialization');
			ircConnectionCompletedCheckLoop = setInterval(function () {if(!ircConnectionCompleted){sendCommandWHOIS(settings.botName, function(data) {if(data != null){ircConnectionCompleted=true;};});}else{clearInterval(ircConnectionCompletedCheckLoop);console.log('joining channels...');whoisIntervalLoop = setInterval(function () {ircJoinMissingChannels();}, 5000);};}, 5000);
	});
	ircConnection.on('close', function() {if(ircConnectionCompleted){clearInterval(whoisIntervalLoop);}else{clearInterval(ircConnectionCompletedCheckLoop);}; setTimeout(function() {initIrc();}, 3000);});
}

ircRelayServer();
initIrc();