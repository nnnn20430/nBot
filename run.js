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

process.on('uncaughtException', function (err) {
    console.log(err);
});

process.stdin.setEncoding('utf8');

process.stdin.on('readable', function() {
	var chunk = process.stdin.read();
	if (chunk !== null) {
		if ((commandArgsRaw = new RegExp('/raw (.*)', 'g').exec(chunk)) != null) {
			ircConnection.write(commandArgsRaw[1]+'\r\n');
		}else{
			ircConnection.write('PRIVMSG '+settings.channel+' :'+chunk+'\r\n');
		}
	}
});

function sendCommandPRIVMSG(data){
	var dataLengthRegExp = new RegExp('.{1,'+(496-settings.botName.length-ircBotWhoisHost[1].length-ircBotWhoisHost[2].length-settings.channel.length)+'}', 'g'), string;
	while ((string = dataLengthRegExp.exec(data)) !== null) {
		ircConnection.write('PRIVMSG '+settings.channel+' :'+string[0]+'\r\n');
	}
}

function sendCommandWHOIS(user, purpose) {
	ircConnection.write('WHOIS '+user+'\r\n');
	if (user != settings.botName) {
		emitter.once('responseWHOIS', function (data) {
			if (data[1] == user) {
				if (purpose == 'whereis') {var channels = new RegExp('('+user+' :([^# \r\n]*#([^ \r\n]+) )+(\r\n)+(?:[^]*(?='+user+' :([^# \r\n]*#([^ \r\n]+) )*(\r\n)*)))+').exec(data[0]), channelRegexp = new RegExp('[^#]*([^ ]*) ', 'g'), result, userChannels = ""; while((result = channelRegexp.exec(channels[0])) !== null){userChannels = userChannels+result[1]+' '};sendCommandPRIVMSG(user+' is on '+userChannels);}
			}
		});
	}
}

var ircBotWhoisHost = "";
function responseHandleWHOIS(data) {
	if (data[1] == settings.botName && new RegExp(settings.botName+' :[^#]*'+settings.channel+' ').exec(data) == null) {console.log('Joining Channel'); ircConnection.write('JOIN '+settings.channel+'\r\n');}
	if (data[1] == settings.botName) { ircBotWhoisHost = new RegExp(data[1]+' ([^ \r\n]+) ([^ *\r\n]+) \\*').exec(data[0]) }
	emitter.emit('responseWHOIS', data);
}

function responseHandlePRIVMSG(data) {
	console.log(data[1]+': '+data[2]);
	var ircMessageARGS = {}, ircMessageARGC = 0, ircMessageARG, ircMessageARGRegex = new RegExp('(?:(?:(?:")+([^"]+)(?:")+)+|([^ ]+)+)+(?: )*', 'g');
	while ((ircMessageARG = ircMessageARGRegex.exec(data[2])) !== null) {if(ircMessageARG[1] != null){ircMessageARGS[ircMessageARGC]=ircMessageARG[1];}else{ircMessageARGS[ircMessageARGC]=ircMessageARG[2];}ircMessageARGC++}
	if (data[2] == ".hug") {sendCommandPRIVMSG('*Hugs '+data[1]+'*');}
	if (data[2] == ".whereami") {sendCommandPRIVMSG('wrong side of the internet');}
	if ((commandArgsWhereis = new RegExp('.where(?:.*)*?(?=is)is (.*)', 'g').exec(data[2])) != null) {sendCommandWHOIS(commandArgsWhereis[1], 'whereis');}
	if (new RegExp('(Hi|Hello) '+settings.botName, 'g').exec(data[2]) != null) {sendCommandPRIVMSG('Hi '+data[1]);}
	if (data[2] == ".isup starbound") {exec("nmap mindcraft.si.eu.org -p 21025", function(error, stdout, stderr){if (RegExp('open', 'g').exec(stdout) != null) {sendCommandPRIVMSG('starbound server is up');}else{sendCommandPRIVMSG('starbound server is down');}});}
	if (ircMessageARGS[0] == ".echo") {sendCommandPRIVMSG(ircMessageARGS[1].replace(/#c(?!si)/g, '\x03').replace(/#csi/g, '\x1B[').replace(new RegExp('#x([0-9a-fA-F]{2})', 'g'), function(regex, hex){return eval('"\\x'+hex+'"');}));}
}

function responseHandleJOIN(data) {
	if (data[1] != settings.botName){sendCommandPRIVMSG('Hi '+data[1]);}
}

function ircDataReceiveHandle(data, ircConnection) {
	//console.log(data);
	var ircWHOIS = new RegExp('311 [^ \r\n]* ([^ \r\n]+) (?:[^ \r\n]* ){2}(?=\\*)\\* :[^\r\n]*(\r\n:[^\r\n]*)+?(?=:End of /WHOIS list):End of /WHOIS list', 'g').exec(data);
	var ircPRIVMSG = new RegExp(':([^! \r\n]*)![^@ \r\n]*@[^ \r\n]* PRIVMSG '+settings.channel+' :([^\r\n]*)', 'g').exec(data);
	var ircJOIN = new RegExp(':([^! \r\n]*)![^@ \r\n]*@[^ \r\n]* JOIN :'+settings.channel, 'g').exec(data);
	if (ircWHOIS != null){responseHandleWHOIS(ircWHOIS);}
	if (ircPRIVMSG != null){responseHandlePRIVMSG(ircPRIVMSG);}
	if (ircJOIN != null){responseHandleJOIN(ircJOIN);}
}
    
function initIrc() {
	ircConnection = net.connect({port: 6667, host: settings.ircServer},
		function() { //'connect' listener
			console.log('connected to server!');
			ircConnection.setEncoding('utf8');
			ircConnection.on('data', function(chunk) { if(chunk.match(/PING :(.*)/) != null){ircConnection.write('PONG :'+chunk.match(/PING :(.*)/)[1]+'\r\n')}else{ircDataReceiveHandle(chunk, ircConnection);}});
			ircConnection.write('NICK '+settings.botName+'\r\n');
			ircConnection.write('USER '+settings.botName+' '+settings.hostName+' '+settings.ircServer+' :'+settings.botName+'\r\n');
			setInterval(function (){sendCommandWHOIS(settings.botName)},5000);
	});
}

initIrc();
