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
	ircConnectionRegistrationCompleted = false,
	ircConnectionRegistrationCompletedCheck,
	authenticatedOpUsers = [];
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
var terminalLastChannel = settings.channels[0];
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
		}else if ((commandArgsChannel = new RegExp('(#[^ \r\n]*)+ ([^\r\n]*){1}', 'g').exec(chunk)) != null) {
			ircConnection.write('PRIVMSG '+commandArgsChannel[1]+' :'+commandArgsChannel[2]+'\r\n');
			terminalLastChannel = commandArgsChannel[1];
		}else if ((commandArgsQuit = new RegExp('/quit(?: ([^\r\n]*)){0,1}', 'g').exec(chunk)) != null) {
			var quitReason = commandArgsQuit[1]||"Leaving";
			ircConnection.write('QUIT :'+quitReason+'\r\n');
			console.log('quiting...');
			setTimeout(function () {ircConnection.end();ircConnection.destroy();process.exit();}, 1000);
		}else{
			ircConnection.write('PRIVMSG '+terminalLastChannel+' :'+chunk+'\r\n');
		}
	}
});

//misc prototypes
Object.defineProperty(Array.prototype, "diff", { 
    value: function(a) {
		return this.filter(function(i) {return a.indexOf(i) < 0;});
    },
    configurable: true,
    writable: true,
    enumerable: false
});

Object.defineProperty(String.prototype, "replaceSpecialChars", { 
    value: function(a) {
		return this.replace(/#c(?!si)/g, '\x03').replace(/#csi/g, '\x1B[').replace(new RegExp('#x([0-9a-fA-F]{2})', 'g'), function(regex, hex){return eval('"\\x'+hex+'"');});
    },
    configurable: true,
    writable: true,
    enumerable: false
});

Object.defineProperty(Array.prototype, "arrayValueAdd", { 
    value: function(a) {
		return this.splice(this.lastIndexOf(this.slice(-1)[0])+1, 0, a);
    },
    configurable: true,
    writable: true,
    enumerable: false
});

Object.defineProperty(Array.prototype, "arrayValueRemove", { 
    value: function(a) {
		return this.splice(this.lastIndexOf(a), 1);
    },
    configurable: true,
    writable: true,
    enumerable: false
});

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
function ircJoinMissingChannels(data) {
	var channelArray=whoisParseChannels(data);
	var missingChannels=settings.channels.diff(channelArray[0]);
	for (channel in missingChannels){
		if(settings.channels.hasOwnProperty(channel)){
			console.log("joining channel: "+missingChannels[channel]);
			ircConnection.write('JOIN '+missingChannels[channel]+'\r\n')
		}
		
	}	
}

//misc functions: return entire help
function ircSendEntireHelpToUser(user) {
	var commandArray = commandHelp('arrayOfCommands'), commandString = "";
	for (command in commandArray) {
		commandString=commandString+settings.commandPrefix+commandHelp('commandInfo', commandArray[command])+'\n';
	}
	sendCommandPRIVMSG('Help for all commands:\n'+commandString, user);
}

//misc functions: get random img from mylittlefacewhen.com
function getRandomLittleFace(channel) {
	function getAcceptedImage(max, channel) {
		var tryImgN = getRandomInt(1, max);
		http.get('http://mylittlefacewhen.com/api/v3/face/?offset='+tryImgN+'&limit=1&format=json', function(res) {
			res.on('data', function (chunk) {
				var imgData = JSON.parse(chunk);
				if (imgData.objects[0].accepted){
					var description = new RegExp('(.*)(?= reacting with) reacting with \'([^"]*?)(?=\',)').exec(imgData.objects[0].description);
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
			sendCommandPRIVMSG('Now Playing: '+RegExCurrentSong[1].replace(/\.[^.]*$/, '')+' | Listeners: '+listeners+' | Tune in at http://mindcraft.si.eu.org/radio/ (dont it sucks)', channel);
		}
	}
	getRadioStatus();
}

//misc functions: is the user op
function isOp(user, checkAuth){
	var isOp = false;
	if (checkAuth == null) {checkAuth=true;};
	for (opUser in settings.opUsers) {
			if (user == settings.opUsers[opUser]) {
				if (checkAuth == true) {
					for (authenticatedOpUser in authenticatedOpUsers) {
							if (user == authenticatedOpUsers[authenticatedOpUser]) {isOp = true;};
					}
				}else if (checkAuth == false){
					isOp = true;
				}
			};
	}
	return isOp;
}

//misc functions: give a user operator status
function giveOp(user) {
	var response = "Unknown Error happend"
	if (isOp(user, false) == false) {
		settings.opUsers.arrayValueAdd(user);
		response = "Success: User is now an Operator";
	}else{
		response = "Error: User is already an Operator";
	}
	return response;
}

//misc functions: take operator status from a user
function takeOp(user) {
	var response = "Unknown Error happend"
	if (isOp(user, false) == true) {
		settings.opUsers.arrayValueRemove(user);
		authenticatedOpUsers.arrayValueRemove(user);
		response = "Success: User is no longer an Operator";
	}else{
		response = "Error: User is not an Operator";
	}
	return response;
}

//misc functions: command help manager and such
function commandHelp(purpose, command) {
	var response;
	helpArray = [['hug', 'hug: gives you a free hug'],
		['whereami', 'whereami: tells you where you are'],
		['whereis', 'whereis "user": lists the channels the user is in (the command can contain anything between where and is)'],
		['isup starbound', 'isup starbound: checks if my starbound server on mindcraft.si.eu.org is up'],
		['echo', 'echo "string": prints string back to the chat'],
		['sendmsg', 'sendmsg "#channel" "string": prints string on the channel (only if the bot is in it)'],
		['view', 'view "url": prints the data located at the url, data must not be bigger than 1KiB'],
		['ping', 'ping "host" "port": pings the port on host'],
		['nbot', 'nbot: prints some info about nBot'],
		['help', 'help: prints help message'],
		['away', 'away: prints a list of away users in the channel'],
		['randomlittleface', 'randomlittleface: get random image from mylittlefacewhen.com'],
		['np', 'np: shows currently playing song on the radio'],
		['raw', 'raw "raw command": make the bot send a raw command to the irc server (op only)'],
		['savesettings', 'savesettings: save current settings to file (op only)'],
		['join', 'join "#channel": make the bot join the channel (op only)'],
		['part', 'part "#channel": make the bot part the channel (op only)'],
		['pass', 'pass "password": authenticate as an Operator (op only)(please send this command directly to the bot)'],
		['logout', 'logout: de-authenticate (op only)'],
		['op', 'op "user": give the user Operator status (op only)'],
		['deop', 'deop "user": take Operator status from the user (op only)'],
		['helpall', 'helpall: prints help for all commands to the user'],
		['responseadd', 'responseadd "trigger" "response": add a response to trigger (op only)'],
		['responseremove', 'responseremove "trigger": remove a response from trigger (op only)'],
		['responseclear', 'responsereclear: remove all set triggered responses (op only)'],
		['functionadd', 'functionadd "name" "code": add a function named name with node.js code (op only)(the function is passed variables data=["nick","msgtarget","txt"] and ircMessageARGS which is an array with txt interpreted as arguments)'],
		['functionremove', 'functionremove "name": remove a function named name (op only)'],
		['functionlist', 'functionlist: prints list of functions (op only)'],
		['functionshow', 'functionshow "name": prints the code of function named name (op only)']];
	if (purpose == 'arrayOfCommands') {
		var commandArray = [];
		for (index in helpArray) {
			commandArray[index] = helpArray[index][0];
		}
		response = commandArray;
	}
	if (purpose == 'commandInfo') {
		response = 'Command not found';
		for (index in helpArray) {
			if (helpArray[index][0] == command) {response = helpArray[index][1];};
		}
	}
	return response;
}

//misc functions: short help message
function getHelp() {
	var helpMessage, commandArray = commandHelp('arrayOfCommands'), commandString = "";
	for (command in commandArray) {
		commandString = commandString+commandArray[command]+", "
	}
	commandString = commandString.replace(/, $/, ".");
	helpMessage = 'Commands are prefixed with "'+settings.commandPrefix+'"\n'+'use '+settings.commandPrefix+'help "command" to get more info about the command\n'+'Current commands are: '+commandString;
	return helpMessage;
}

//misc functions: handle bot commands
function botSimpleCommandHandle(ircData, ircMessageARGS) {
	var command = ircMessageARGS[0];
	if (command.substr(0, settings.commandPrefix.length) == settings.commandPrefix) {
		command = command.substr(settings.commandPrefix.length);
		var target = ircData[2]; if (new RegExp('^#.*$').exec(ircData[2]) == null) {target = ircData[1]};
		switch (command) {
			case 'hug': sendCommandPRIVMSG('*Hugs '+ircData[1]+'*', target); break;
			case 'whereami': sendCommandPRIVMSG('wrong side of the internet', target); break;
			case 'isup': if (ircMessageARGS[1] == "starbound") {exec("nmap mindcraft.si.eu.org -p 21025", function(error, stdout, stderr){if (RegExp('open', 'g').exec(stdout) != null) {sendCommandPRIVMSG('starbound server is up', target);}else{sendCommandPRIVMSG('starbound server is down', target);};})}; break;
			case 'echo': sendCommandPRIVMSG(ircMessageARGS[1].replaceSpecialChars(), target); break;
			case 'view': http.get(ircMessageARGS[1], function(res) {res.on('data', function (chunk) {if(chunk.length < settings.command_request_maxBytes){sendCommandPRIVMSG(chunk, target);}});}).on('error', function(e) {sendCommandPRIVMSG("Got error: "+e.message, target);}); break;
			case 'ping': pingTcpServer(ircMessageARGS[1], ircMessageARGS[2], function (status) {var statusString; if(status){statusString="open"}else{statusString="closed"}sendCommandPRIVMSG("Port "+ircMessageARGS[2]+" on "+ircMessageARGS[1]+" is: "+statusString, target);}); break;
			case 'nbot': sendCommandPRIVMSG("I'm a random bot written for fun, you can see my code here: http://mindcraft.si.eu.org/git/?p=nBot.git", target); break;
			case 'help': if(ircMessageARGS[1] != null){sendCommandPRIVMSG(commandHelp("commandInfo", ircMessageARGS[1]), target);}else{sendCommandPRIVMSG(getHelp(), target)}; break;
			case 'away': sendCommandWHO(target, function (data) {var ircGoneUsersRegex = new RegExp('([^ \r\n]+){1} G', 'g'), ircGoneUsersString = "", ircGoneUser; while((ircGoneUser = ircGoneUsersRegex.exec(data[0])) != null){ircGoneUsersString=ircGoneUsersString+ircGoneUser[1]+", ";};sendCommandPRIVMSG("Away users are: "+ircGoneUsersString.replace(/, $/, ".").replace(/^$/, 'No users are away.'), target);}); break;
			case 'randomlittleface': getRandomLittleFace(target); break;
			case 'np': printRadioStatus(target); break;
			case 'raw': if(isOp(ircData[1]) == true) {ircConnection.write(ircMessageARGS[1]+'\r\n');}; break;
			case 'savesettings': if(isOp(ircData[1]) == true) {fs.writeFile('settings.json', JSON.stringify(settings, null, '\t'), function (err) {if (err) throw err; console.log('It\'s saved!');});}; break;
			case 'join': if(isOp(ircData[1]) == true) {settings.channels.arrayValueAdd(ircMessageARGS[1]);}; break;
			case 'part': if(isOp(ircData[1]) == true) {settings.channels.arrayValueRemove(ircMessageARGS[1]);ircConnection.write('PART '+ircMessageARGS[1]+' :'+ircMessageARGS[2]+'\r\n');}; break;
			case 'pass': if(isOp(ircData[1], false) == true && isOp(ircData[1]) == false) {if(ircMessageARGS[1] == settings.opUsers_password){sendCommandPRIVMSG('Success: Correct password', target);authenticatedOpUsers.arrayValueAdd(ircData[1]);}else{sendCommandPRIVMSG('Error: Wrong password', target);};}; break;
			case 'logout': if(isOp(ircData[1]) == true) {authenticatedOpUsers.arrayValueRemove(ircData[1]);sendCommandPRIVMSG('Success: You have been de-authenticated', target);}; break;
			case 'op': if(isOp(ircData[1]) == true) {sendCommandPRIVMSG(giveOp(ircMessageARGS[1]), target);}; break;
			case 'deop': if(isOp(ircData[1]) == true) {sendCommandPRIVMSG(takeOp(ircMessageARGS[1]), target);}; break;
			case 'helpall': ircSendEntireHelpToUser(ircData[1]); break;
			case 'responseadd': if(isOp(ircData[1]) == true) {settings.specificResponses[ircMessageARGS[1]]=ircMessageARGS[2]}; break;
			case 'responseremove': if(isOp(ircData[1]) == true) {delete settings.specificResponses[ircMessageARGS[1]]}; break;
			case 'responseclear': if(isOp(ircData[1]) == true) {settings.specificResponses = {};}; break;
			case 'functionadd': if(isOp(ircData[1]) == true) {settings.dynamicFunctions[ircMessageARGS[1]]=ircMessageARGS[2]}; break;
			case 'functionremove': if(isOp(ircData[1]) == true) {delete settings.dynamicFunctions[ircMessageARGS[1]]}; break;
			case 'functionlist': if(isOp(ircData[1]) == true) {var dynamicFunctionList=""; for (dynamicFunction in settings.dynamicFunctions) {dynamicFunctionList=dynamicFunction+", "};sendCommandPRIVMSG("Current functions are: "+dynamicFunctionList.replace(/, $/, ".").replace(/^$/, 'No dynamic functions found.'), target);}; break;
			case 'functionshow': if(isOp(ircData[1]) == true) {if ((dynamicFunction = settings.dynamicFunctions[ircMessageARGS[1]]) !== undefined) {sendCommandPRIVMSG(dynamicFunction, target);}else{sendCommandPRIVMSG("Error: Function not found", target);};}; break;
		}
	};
}

//misc functions: handle dynamic bot functions
function botDynamicFunctionHandle(ircData, ircMessageARGS) {
	for (dynamicFunction in settings.dynamicFunctions) {
		dynamicFunction=eval("(function(data, ircMessageARGS){"+settings.dynamicFunctions[dynamicFunction]+"})");
		dynamicFunction(ircData, ircMessageARGS);
	}
}

//irc command functions
function sendCommandPRIVMSG(data, to, timeout, forceTimeout){
	var privmsgLenght = 512-(":"+settings.botName+"!"+ircBotWhoisHost[1]+"@"+ircBotWhoisHost[2]+" "+to+" :\r\n").length
	var dataLengthRegExp = new RegExp('.{1,'+privmsgLenght+'}', 'g'), stringArray = [], c = 0, timeout=timeout||1000;
	function writeData(data, to, c, timeout) {
		setTimeout(function() {ircConnection.write('PRIVMSG '+to+' :'+data[c]+'\r\n'); c++; if (data[c] != null) {writeData(data, to, c, timeout)}; }, timeout)
	}
	while ((string = dataLengthRegExp.exec(data)) !== null) {
		stringArray[c]=string[0];c++
	}
	if (!forceTimeout) {
		if (c <= 1) {timeout=0};
	}
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
	var ircMessageARGS = {}, ircMessageARGC = 0, ircMessageARG, ircMessageARGRegex = new RegExp('(?:(?:(?:")+((?:(?:[^\\\\"]+)(?:\\\\")*)+)(?:"))+|([^ ]+)+)+(?: ){0,1}', 'g');
	while ((ircMessageARG = ircMessageARGRegex.exec(data[3])) !== null) {if(ircMessageARG[1] != null){ircMessageARGS[ircMessageARGC]=ircMessageARG[1].replace(new RegExp('\\\\"', 'g'), '"');}else{ircMessageARGS[ircMessageARGC]=ircMessageARG[2];}ircMessageARGC++};
	var target = data[2]; if (new RegExp('^#.*$').exec(data[2]) == null) {target = data[1]};
	//process commands and such
	botSimpleCommandHandle(data, ircMessageARGS);
	botDynamicFunctionHandle(data, ircMessageARGS);
	if ((commandArgsWhereis = new RegExp('^'+settings.commandPrefix+'where(?:.*)*?(?=is)is ([^ ]*)', 'g').exec(data[3])) != null) {sendCommandWHOIS(commandArgsWhereis[1], function(data){var channelArray=whoisParseChannels(data), channels=""; for (channel in channelArray[0]){if(channelArray[0].hasOwnProperty(channel)){channels=channels+channelArray[0][channel]+' '}};sendCommandPRIVMSG(data[1]+' is on: '+channels.replace(/^$/, 'User not found on any channel'), target);});};
	if (new RegExp('(Hi|Hello) '+settings.botName, 'gi').exec(data[3]) != null) {sendCommandPRIVMSG('Hi '+data[1], target);};
	if (new RegExp('(?:'+settings.commandPrefix+'channelmsg|'+settings.commandPrefix+'cmsg|'+settings.commandPrefix+'chanmsg|'+settings.commandPrefix+'sendmsg)', 'gi').exec(ircMessageARGS[0])) {sendCommandPRIVMSG(ircMessageARGS[2].replaceSpecialChars(), ircMessageARGS[1]);};
	if (RegExp('(?:djazz|nnnn20430|IcyDiamond)', 'gi').exec(data[1]) && new RegExp('(?:home time|home tiem)', 'gi').exec(data[3])) {sendCommandPRIVMSG('WOO! HOME TIME!!!', target);};
	if ((specificResponse = settings.specificResponses[data[3]]) !== undefined) {sendCommandPRIVMSG(specificResponse, target);};
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
		if(data[1] == "nnnn20430"){sendCommandPRIVMSG('My Creator is back!!!', data[4]);};
	};
}

function responseHandlePART(data) {
	if (data[1] != settings.botName){
		sendCommandPRIVMSG('Bye '+data[1], data[4]);
		if(isOp(data[1])){authenticatedOpUsers.arrayValueRemove(data[1]);sendCommandPRIVMSG('You have left a channel with '+settings.botName+' in it you have been de-authenticated', data[1]);};
	};
}

function responseHandleQUIT(data) {
	if (data[1] != settings.botName){
		if(isOp(data[1])){authenticatedOpUsers.arrayValueRemove(data[1]);};
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
		if (ircConnectionRegistrationCompleted==false) {if (new RegExp('001 '+settings.botName, 'g').exec(line) != null){ircConnectionRegistrationCompleted=true;}};
		var ircPRIVMSG = new RegExp(':([^! \r\n]+)![^@ \r\n]+@[^ \r\n]+ PRIVMSG ((?:#){0,1}[^ \r\n]+) :([^\r\n]*)', 'g').exec(line); if (ircPRIVMSG != null){responseHandlePRIVMSG(ircPRIVMSG);};
		var ircJOIN = new RegExp(':([^! \r\n]+)!([^@ \r\n]+)@([^ \r\n]+) JOIN (?::){0,1}(#[^ \r\n]*)', 'g').exec(line); if (ircJOIN != null){responseHandleJOIN(ircJOIN);};
		var ircPART = new RegExp(':([^! \r\n]+)!([^@ \r\n]+)@([^ \r\n]+) PART ((?:#){0,1}[^ \r\n]+)(?: :){0,1}([^\r\n]*)', 'g').exec(line); if (ircPART != null){responseHandlePART(ircPART);};
		var ircQUIT = new RegExp(':([^! \r\n]+)![^@ \r\n]+@[^ \r\n]+ QUIT :([^\r\n]*)', 'g').exec(line); if (ircQUIT != null){responseHandleQUIT(ircQUIT);};
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
			console.log('waiting for server to complete connection registration');
			ircConnectionRegistrationCompletedCheck = setInterval(function () {if(ircConnectionRegistrationCompleted){clearInterval(ircConnectionRegistrationCompletedCheck);console.log('joining channels...');sendCommandWHOIS(settings.botName, function (data) {ircJoinMissingChannels(data);});whoisIntervalLoop = setInterval(function () {sendCommandWHOIS(settings.botName, function (data) {ircJoinMissingChannels(data);});}, 5000);};}, 1000);
	});
	ircConnection.setTimeout(60*1000);
	ircConnection.on('error', function (e) {ircConnection.end();ircConnection.destroy();console.log("Got error: "+e.message);});
	ircConnection.on('timeout', function (e) {ircConnection.end();ircConnection.destroy();console.log('connection timeout');});
	ircConnection.on('close', function() {if(ircConnectionRegistrationCompleted){clearInterval(whoisIntervalLoop);}else{clearInterval(ircConnectionRegistrationCompletedCheck);}; setTimeout(function() {initIrc();}, 3000);});
}

if(settings.ircRelayServerEnabled){ircRelayServer();};
initIrc();
