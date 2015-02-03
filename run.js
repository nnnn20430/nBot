#!/usr/bin/env node
var exec = require('child_process'),
	//request = require('request'),
	http = require('http'),
	net = require('net'),
	readline = require('readline'),
	fs = require('fs'),
	util = require('util'),
	ircConnection = null,
	settings = require('./settings.json');

var events = require("events");
var emitter = new events.EventEmitter();
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
		if ((commandArgsRaw = new RegExp('/raw (.*)', 'g').exec(chunk)) != null) {
			ircConnection.write(commandArgsRaw[1]+'\r\n');
		}else if ((commandArgsJoin = new RegExp('/join (#[^ ]*)', 'g').exec(chunk)) != null) {
			settings.channels.splice(settings.channels.lastIndexOf(settings.channels.slice(-1)[0])+1, 0, commandArgsJoin[1]);
		}else if ((commandArgsPart = new RegExp('/part (#[^ ]*)( .*)*', 'g').exec(chunk)) != null) {
			var partReason = "Leaving";
			if (commandArgsPart[2] != null) {partReason=commandArgsPart[2]}
			settings.channels.splice(settings.channels.lastIndexOf(commandArgsPart[1]), 1);
			ircConnection.write('PART '+commandArgsPart[1]+' '+partReason+'\r\n');
		}else if ((commandArgsChannel = new RegExp('(#[^ ]*)+ (.*)*', 'g').exec(chunk)) != null) {
			ircConnection.write('PRIVMSG '+commandArgsChannel[1]+' :'+commandArgsChannel[2]+'\r\n');
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

//irc command functions
function sendCommandPRIVMSG(data, channel){
	var privmsgLenght = 512-(":"+settings.botName+"!"+ircBotWhoisHost[1]+"@"+ircBotWhoisHost[2]+" "+channel+" :\r\n").length
	var dataLengthRegExp = new RegExp('.{1,'+privmsgLenght+'}', 'g'), string;
	while ((string = dataLengthRegExp.exec(data)) !== null) {
		ircConnection.write('PRIVMSG '+channel+' :'+string[0]+'\r\n');
	}
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
	console.log(data[1]+': '+data[3]);
	var ircMessageARGS = {}, ircMessageARGC = 0, ircMessageARG, ircMessageARGRegex = new RegExp('(?:(?:(?:")+([^"]+)(?:")+)+|([^ ]+)+)+(?: )*', 'g');
	while ((ircMessageARG = ircMessageARGRegex.exec(data[3])) !== null) {if(ircMessageARG[1] != null){ircMessageARGS[ircMessageARGC]=ircMessageARG[1];}else{ircMessageARGS[ircMessageARGC]=ircMessageARG[2];}ircMessageARGC++}
	if (data[3] == ".hug") {sendCommandPRIVMSG('*Hugs '+data[1]+'*', data[2]);}
	if (data[3] == ".whereami") {sendCommandPRIVMSG('wrong side of the internet', data[2]);}
	if ((commandArgsWhereis = new RegExp('^.where(?:.*)*?(?=is)is ([^ ]*)', 'g').exec(data[3])) != null) {var originChannel = data[2];sendCommandWHOIS(commandArgsWhereis[1], function(data){var channelArray=whoisParseChannels(data), channels=""; for (channel in channelArray[0]){if(channelArray[0].hasOwnProperty(channel)){channels=channels+channelArray[0][channel]+' '}};sendCommandPRIVMSG(data[1]+' is on '+channels, originChannel);});}
	if (new RegExp('(Hi|Hello) '+settings.botName, 'gi').exec(data[3]) != null) {sendCommandPRIVMSG('Hi '+data[1], data[2]);}
	if (data[3] == ".isup starbound") {exec("nmap mindcraft.si.eu.org -p 21025", function(error, stdout, stderr){if (RegExp('open', 'g').exec(stdout) != null) {sendCommandPRIVMSG('starbound server is up', data[2]);}else{sendCommandPRIVMSG('starbound server is down', data[2]);}});}
	if (ircMessageARGS[0] == ".echo") {sendCommandPRIVMSG(ircMessageARGS[1].replaceSpecialChars(), data[2]);}
	if (new RegExp('(?:.channelmsg|.cmsg|.chanmsg)', 'gi').exec(ircMessageARGS[0])) {sendCommandPRIVMSG(ircMessageARGS[2].replaceSpecialChars(), ircMessageARGS[1]);}
}

var ircBotWhoisHost = "";
function responseHandleWHOIS(data) {
	if (data[1] == settings.botName) { ircBotWhoisHost = new RegExp(data[1]+' ([^ \r\n]+) ([^ *\r\n]+) \\*').exec(data[0]) }
	emitter.emit('responseWHOIS', data);
}

function responseHandleJOIN(data) {
	if (data[1] != settings.botName){sendCommandPRIVMSG('Hi '+data[1], data[2]);}
}

//main irc data receiving function
function ircDataReceiveHandle(data, ircConnection) {
	//console.log(data);
	var ircWHOIS = new RegExp('311 [^ \r\n]* ([^ \r\n]+) (?:[^ \r\n]+ ){2}(?=\\*)\\* :[^\r\n]*(\r\n:[^\r\n]*)+?(?=:End of /WHOIS list):End of /WHOIS list', 'g').exec(data);
	var ircPRIVMSG = new RegExp(':([^! \r\n]+)![^@ \r\n]+@[^ \r\n]+ PRIVMSG (#[^ \r\n]+) :([^\r\n]*)', 'g').exec(data);
	var ircJOIN = new RegExp(':([^! \r\n]+)![^@ \r\n]+@[^ \r\n]+ JOIN :(#[^ \r\n]+)', 'g').exec(data);
	if (ircWHOIS != null){responseHandleWHOIS(ircWHOIS);}
	if (ircPRIVMSG != null){responseHandlePRIVMSG(ircPRIVMSG);}
	if (ircJOIN != null){responseHandleJOIN(ircJOIN);}
}

//starts the bot
function initIrc() {
	ircConnection = net.connect({port: 6667, host: settings.ircServer},
		function() { //'connect' listener
			console.log('connected to server!');
			ircConnection.setEncoding('utf8');
			ircConnection.on('data', function(chunk) { if(chunk.match(/PING :(.*)/) != null){ircConnection.write('PONG :'+chunk.match(/PING :(.*)/)[1]+'\r\n')}else{ircDataReceiveHandle(chunk, ircConnection);}});
			ircConnection.write('NICK '+settings.botName+'\r\n');
			ircConnection.write('USER '+settings.botName+' '+settings.hostName+' '+settings.ircServer+' :'+settings.botName+'\r\n');
			setInterval(function (){sendCommandWHOIS(settings.botName, function(data){var channelArray=whoisParseChannels(data); var missingChannels=settings.channels.diff(channelArray[0]); for (channel in missingChannels){if(settings.channels.hasOwnProperty(channel)){ircConnection.write('JOIN '+missingChannels[channel]+'\r\n')}}})},5000);
	});
}

initIrc();
