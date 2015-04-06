/*jshint node: true*/

"use strict";
//variables
var http = require('http');
var net = require('net');
var exec = require('child_process').exec;
var events = require("events");

var botObj,
	botF,
	settings,
	pluginSettings,
	ircChannelUsers,
	plugin = module.exports,
	pluginFuncObj,
	authenticatedOpUsers = [];
	
var settingsConstructor = function (modified) {
	var settings, attrname;
	if (this!==settingsConstructor) {
		settings = {
			command_request_maxBytes: 1024,
			radioStatus_mpdServer: 'localhost',
			radioStatus_mpdServerPort: 6600,
			radioStatus_icecastStatsUrl: 'http://localhost:8000/status-json.xsl',
			opUsers: { 'nnnn20430': '' },
			opUsers_commandsAllowChanOp: false,
			commandPrefix: '.',
			handleConnectionErrors: true,
			reactToJoinPart: true,
			specificResponses: {},
			dynamicFunctions: {}
		};
		for (attrname in modified) {settings[attrname]=modified[attrname];}
		return settings;
	}
};

//misc bot functions: ping the server by connecting and quickly closing
function pingTcpServer(host, port, callback){
	function returnResults(data) {callback(data);}
	var pingHost = net.connect({port: port, host: host}, function () {
		returnResults(true);
		pingHost.end();pingHost.destroy();
	});
	pingHost.on('error', function () {pingHost.end();pingHost.destroy();returnResults(false);});
}

//misc bot functions: return entire help
function ircSendEntireHelpToUser(user) {
	var commandArray = commandHelp('arrayOfCommands'), commandString = "";
	for (var command in commandArray) {
		commandString=commandString+pluginSettings.commandPrefix+commandHelp('commandInfo', commandArray[command])+'\n';
	}
	botF.sendCommandPRIVMSG('Help for all commands:\n'+commandString, user);
}

//misc bot functions: get random img from mylittlefacewhen.com
function getRandomLittleFace(channel) {
	function getAcceptedImage(max, channel) {
		var tryImgN = getRandomInt(1, max);
		http.get('http://mylittlefacewhen.com/api/v3/face/?offset='+tryImgN+'&limit=1&format=json', function(res) {
			res.on('data', function (chunk) {
				var imgData = JSON.parse(chunk);
				if (imgData.objects[0].accepted){
					var description = new RegExp('(.*)(?= reacting with) reacting with \'([^"]*?)(?=\',)').exec(imgData.objects[0].description);
					botF.sendCommandPRIVMSG('Random mylittlefacewhen.com image: http://mylittlefacewhen.com/f/'+imgData.objects[0].id+' "'+description[1]+": "+description[2]+'"', channel);
				}else if (imgData.objects[0].accepted === false){getAcceptedImage(max, channel);}
			});
		}).on('error', function(e) {botF.sendCommandPRIVMSG("Got error: "+e.message, channel);});
	}
	http.get('http://mylittlefacewhen.com/api/v3/face/?offset=1&limit=1&format=json', function(res) {
		res.on('data', function (chunk) {
			getAcceptedImage((JSON.parse(chunk).meta.total_count)-1, channel);
		});
	}).on('error', function(e) {botF.sendCommandPRIVMSG("Got error: "+e.message, channel);});
}

//misc bot functions: get random int
function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

//misc bot functions: radio status
function printRadioStatus(channel) {
	var currentsong, listeners;
	function getRadioStatus() {
		function getCurrentSong() {
			var mpdConnection = net.connect({port: pluginSettings.radioStatus_mpdServerPort, host: pluginSettings.radioStatus_mpdServer},
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
						}
					});
			});
			mpdConnection.setTimeout(10000);
			mpdConnection.on('error', function (e) {mpdConnection.end();mpdConnection.destroy();botF.sendCommandPRIVMSG("Got error: "+e.message, channel);});
			mpdConnection.on('timeout', function (e) {mpdConnection.end();mpdConnection.destroy();botF.sendCommandPRIVMSG("Got error: Connection Timeout", channel);});
		}
		function getListeners() {
			http.get(pluginSettings.radioStatus_icecastStatsUrl, function(res) {
				res.setEncoding('utf8');
				res.on('data', function (chunk) {
					listeners=JSON.parse(chunk).icestats.source.listeners;
					getRadioStatus();
				});
			}).on('error', function(e) {botF.sendCommandPRIVMSG("Got error: "+e.message, channel);});
		}
		if (currentsong === undefined) {
			getCurrentSong();
		}else if (listeners === undefined) {
			getListeners();
		}else {
			var RegExCurrentSong=new RegExp('file: .*?(?=[^/\n]+\n)([^/\n]+)\n').exec(currentsong);
			if (RegExCurrentSong !== null) {
				botF.sendCommandPRIVMSG('Now Playing: '+RegExCurrentSong[1].replace(/\.[^.]*$/, '')+' | Listeners: '+listeners+' | Tune in at http://mindcraft.si.eu.org/radio/', channel);
			}
		}
	}
	getRadioStatus();
}

//misc bot functions: is the user op
function isOp(user, checkAuth){
	var isOpUser = false;
	if (checkAuth === undefined) {checkAuth=true;}
	if (pluginSettings.opUsers[user]) {
		if (checkAuth === true) {
			for (var authenticatedOpUser in authenticatedOpUsers) {
					if (user == authenticatedOpUsers[authenticatedOpUser]) {isOpUser = true;}
			}
		}else if (checkAuth === false){
			isOpUser = true;
		}
	}
	return isOpUser;
}

//misc bot functions: give a user operator status
function giveOp(user, pass) {
	var response = "Unknown Error happend";
	if (!user && !pass) {
		response = "Error: User and password must be defined";
	} else if (isOp(user, false) === false) {
		pluginSettings.opUsers[user]=pass;
		response = "Success: User is now an Operator";
	} else {
		response = "Error: User is already an Operator";
	}
	return response;
}

//misc bot functions: take operator status from a user
function takeOp(user) {
	var response = "Unknown Error happend";
	if (isOp(user, false) === true) {
		delete pluginSettings.opUsers[user];
		plugin.authenticatedOpUsers.arrayValueRemove(user);
		response = "Success: User is no longer an Operator";
	}else{
		response = "Error: User is not an Operator";
	}
	return response;
}

//misc bot functions: authenticate user
function authenticateOp(user, pass, ignorePass) {
	var response = "Unknown Error happend";
	if(isOp(user, false) === true && isOp(user) === false) {
		if(pass == pluginSettings.opUsers[user]  && pluginSettings.opUsers[user] !== ""){
			response = "Success: Correct login";
			authenticatedOpUsers.arrayValueAdd(user);
		} else if (pluginSettings.opUsers[user] && ignorePass) {
			response = "Success: Password ignored";
			authenticatedOpUsers.arrayValueAdd(user);
		} else {
			response = "Error: Wrong username or password";
		}
	}
	return response;
}

//misc bot functions: de-authenticate user
function deAuthenticateOp(user) {
	var response = "Unknown Error happend";
	if(isOp(user) === true) {
		response = "Success: User has been de-authenticated";
		authenticatedOpUsers.arrayValueRemove(user);
	} else {
		response = "Success: User is not authenticated";
	}
	return response;
}

//misc bot functions: short help message
function getHelp() {
	var helpMessage, commandArray = commandHelp('arrayOfCommands'), commandString = "";
	for (var command in commandArray) {
		commandString = commandString+commandArray[command]+", ";
	}
	commandString = commandString.replace(/, $/, ".");
	helpMessage = 'Commands are prefixed with "'+pluginSettings.commandPrefix+'"\n'+'use '+pluginSettings.commandPrefix+'help "command" to get more info about the command\n'+'Current commands are: '+commandString;
	return helpMessage;
}

//misc bot functions: is the user op on channel
function isChanOp(user, channel){
	var isUserChanOp = false;
	if (ircChannelUsers[channel] && ircChannelUsers[channel][user] && ircChannelUsers[channel][user].mode) {
		if (ircChannelUsers[channel][user].mode.replace(/^(@|~|%|&)$/, "isOp") == "isOp" ) {isUserChanOp = true;}
		if (ircChannelUsers[channel][user].isGlobalOP) {isUserChanOp = true;}
	}
	return isUserChanOp;
}

//bot command handle functions

//bot command handle functions: command help manager
function commandHelp(purpose, command) {
	var response, index;
	if (purpose == 'arrayOfCommands') {
		var commandArray = [];
		for (index in plugin.botCommandHelpArray) {
			if(plugin.botCommandHelpArray.hasOwnProperty(index)) {
				commandArray[index] = plugin.botCommandHelpArray[index][0];
			}
		}
		response = commandArray;
	}
	if (purpose == 'commandInfo') {
		response = 'Command not found';
		for (index in plugin.botCommandHelpArray) {
			if(plugin.botCommandHelpArray.hasOwnProperty(index)) {
				if (plugin.botCommandHelpArray[index][0] == command) {response = plugin.botCommandHelpArray[index][1];}
			}
		}
	}
	return response;
}

//bot command handle functions: handle bot commands
function botSimpleCommandHandle(ircData, ircMessageARGS) {
	var command = ircMessageARGS[0];
	if (command.substr(0, pluginSettings.commandPrefix.length) == pluginSettings.commandPrefix) {
		command = command.substr(pluginSettings.commandPrefix.length);
		var target = ircData[2]; if (new RegExp('^#.*$').exec(ircData[2]) === null) {target = ircData[1];}
		if (plugin.botSimpleCommandObject[command] !== undefined) {
			plugin.botSimpleCommandObject[command]({ircData: ircData, ircMessageARGS: ircMessageARGS, responseTarget: target});
		}
	}
}

//bot command handle functions: handle dynamic bot functions
function botDynamicFunctionHandle(ircData, ircMessageARGS) {
	/*jshint -W061 */
	var dynamicFunction;
	for (var dynamicFunctionName in pluginSettings.dynamicFunctions) {
		try {
			dynamicFunction=eval("(function (data, ircMessageARGS) {"+pluginSettings.dynamicFunctions[dynamicFunctionName]+"})");
			dynamicFunction(ircData, ircMessageARGS);
		} catch (e) {
			botF.debugMsg('Error: Dynamic function "'+dynamicFunctionName+'" is erroneous');
		}
	}
}

//bot command handle functions: pluggable functions (to make it easier for plugins to add or remove functions)
function botPluggableFunctionHandle(ircData, ircMessageARGS) {
	var target = ircData[2]; if (new RegExp('^#.*$').exec(ircData[2]) === null) {target = ircData[1];}
	for (var pluggableFunction in plugin.botPluggableFunctionObject) {
		plugin.botPluggableFunctionObject[pluggableFunction]({ircData: ircData, ircMessageARGS: ircMessageARGS, responseTarget: target});
	}
}

//handle irc connection creation from bot
function pluginHandleIrcConnectionCreation(ircConnection) {
	if (pluginSettings.handleConnectionErrors) {
		ircConnection.setTimeout(60*1000);
		ircConnection.once('error', function (e) {ircConnection.end();ircConnection.destroy();botF.debugMsg("Got error: "+e.message);});
		ircConnection.once('timeout', function (e) {ircConnection.end();ircConnection.destroy();botF.debugMsg('connection timeout');});
		ircConnection.once('close', function() {setTimeout(function() {botF.initIrcBot();}, 3000);});
	}
}

//handle PRIVMSG from bot
function pluginHandlePRIVMSG(data) {
	var rawmsg = data[0], from = data[1], to = data[4], message = data[5];
	var ircMessageARGS = botF.getArgsFromString(message)[0];
	var target = to; if (new RegExp('^#.*$').exec(to) === null) {target = from;}
	//process commands and such
	botSimpleCommandHandle([rawmsg, from, to, message], ircMessageARGS);
	botDynamicFunctionHandle([rawmsg, from, to, message], ircMessageARGS);
	botPluggableFunctionHandle([rawmsg, from, to, message], ircMessageARGS);
	var specificResponse; if ((specificResponse = pluginSettings.specificResponses[message]) !== undefined) {botF.sendCommandPRIVMSG(specificResponse, target);}
}

//handle JOIN from bot
function pluginHandleJOIN(data) {
	if (data[1] != settings.botName){
		if (pluginSettings.reactToJoinPart === true) {
			botF.sendCommandPRIVMSG('Welcome '+data[1]+' to channel '+data[4], data[4]);
		}
		if(data[1] == "nnnn20430"){botF.sendCommandPRIVMSG('My Creator is here!!!', data[4]);}
	}
}

//handle PART from bot
function pluginHandlePART(data) {
	if (data[1] != settings.botName){
		if (pluginSettings.reactToJoinPart === true) {
			botF.sendCommandPRIVMSG('Goodbye '+data[1], data[4]);
		}
		if(isOp(data[1])){authenticatedOpUsers.arrayValueRemove(data[1]);botF.sendCommandPRIVMSG('You have left a channel with '+settings.botName+' in it you have been de-authenticated', data[1]);}
	}
}

//handle QUIT from bot
function pluginHandleQUIT(data) {
	if (data[1] != settings.botName){
		if(isOp(data[1])){authenticatedOpUsers.arrayValueRemove(data[1]);}
		for (var channel in ircChannelUsers) {
			if (ircChannelUsers[channel][data[1]] !== undefined) {
				if (pluginSettings.reactToJoinPart === true) {
					botF.sendCommandPRIVMSG('Goodbye '+data[1], channel);
				}
			}
		}
	}
}

//handle KICK from bot
function pluginHandleKICK(data) {
	if (data[4] != settings.botName){
		if(isOp(data[4])){authenticatedOpUsers.arrayValueRemove(data[3]);botF.sendCommandPRIVMSG('You have been kicked from a channel with '+settings.botName+' in it you have been de-authenticated', data[3]);}
	}
}

//export functions
pluginFuncObj = {
	pingTcpServer: pingTcpServer,
	ircSendEntireHelpToUser: ircSendEntireHelpToUser,
	getRandomLittleFace: getRandomLittleFace,
	getRandomInt: getRandomInt,
	printRadioStatus: printRadioStatus,
	isOp: isOp,
	giveOp: giveOp,
	takeOp: takeOp,
	getHelp: getHelp,
	isChanOp: isChanOp,
	commandHelp: commandHelp,
	botSimpleCommandHandle: botSimpleCommandHandle,
	botDynamicFunctionHandle: botDynamicFunctionHandle,
	pluginHandlePRIVMSG: pluginHandlePRIVMSG
};
for (var name in pluginFuncObj) {module.exports[name] = pluginFuncObj[name];}

module.exports.botCommandHelpArray = [
	['hug', 'hug: gives you a free hug'],
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
	['login', 'login "password": authenticate as an Operator (op only)(please send this command directly to the bot)'],
	['logout', 'logout: de-authenticate (op only)'],
	['op', 'op "user": give the user Operator status (op only)'],
	['deop', 'deop "user": take Operator status from the user (op only)'],
	['helpall', 'helpall: prints help for all commands to the user'],
	['responseadd', 'responseadd "trigger" "response": add a response to trigger (op only)'],
	['responseremove', 'responseremove "trigger": remove a response from trigger (op only)'],
	['responselist', 'responselist: prints list of responses (op only)'],
	['responseclear', 'responsereclear: remove all set triggered responses (op only)'],
	['functionadd', 'functionadd "name" "code": add a function named name with node.js code (op only)(the function is passed variables data=["rawmsg","nick","msgtarget","txt"] and ircMessageARGS which is an array with txt interpreted as arguments)'],
	['functionremove', 'functionremove "name": remove a function named name (op only)'],
	['functionlist', 'functionlist: prints list of functions (op only)'],
	['functionshow', 'functionshow "name": prints the code of function named name (op only)']
];

module.exports.botSimpleCommandObject = {
	hug: function (data) {botF.sendCommandPRIVMSG('*Hugs '+data.ircData[1]+'*', data.responseTarget);},
	whereami: function (data) {botF.sendCommandPRIVMSG('wrong side of the internet', data.responseTarget);},
	isup: function (data) {if (data.ircMessageARGS[1] == "starbound") {exec("nmap mindcraft.si.eu.org -p 21025", function(error, stdout, stderr){if (new RegExp('open', 'g').exec(stdout) !== null) {botF.sendCommandPRIVMSG('starbound server is up', data.responseTarget);}else{botF.sendCommandPRIVMSG('starbound server is down', data.responseTarget);}});}},
	echo: function (data) {botF.sendCommandPRIVMSG(data.ircMessageARGS[1].replaceSpecialChars(), data.responseTarget);},
	sendmsg: function (data) {botF.sendCommandPRIVMSG(data.ircMessageARGS[2].replaceSpecialChars(), data.ircMessageARGS[1]);},
	view: function (data) {http.get(data.ircMessageARGS[1], function(res) {res.on('data', function (chunk) {if(chunk.length < pluginSettings.command_request_maxBytes){botF.sendCommandPRIVMSG(chunk, data.responseTarget);}});}).on('error', function(e) {botF.sendCommandPRIVMSG("Got error: "+e.message, data.responseTarget);});},
	ping: function (data) {pingTcpServer(data.ircMessageARGS[1], data.ircMessageARGS[2], function (status) {var statusString; if(status){statusString="open";}else{statusString="closed";}botF.sendCommandPRIVMSG("Port "+data.ircMessageARGS[2]+" on "+data.ircMessageARGS[1]+" is: "+statusString, data.responseTarget);});},
	nbot: function (data) {botF.sendCommandPRIVMSG("I'm a random bot written for fun, you can see my code here: http://git.mindcraft.si.eu.org/?p=nBot.git", data.responseTarget);},
	help: function (data) {if(data.ircMessageARGS[1] !== undefined){botF.sendCommandPRIVMSG(commandHelp("commandInfo", data.ircMessageARGS[1]), data.responseTarget);}else{botF.sendCommandPRIVMSG(getHelp(), data.responseTarget);}},
	away: function (data) {botF.sendCommandWHO(data.responseTarget, function (whoData) {var ircGoneUsersRegex = new RegExp('352 (?:[^ \r\n]* )(?:[^ \r\n]+) (?:[^ \r\n]+ ){3}([^ \r\n]+) G', 'g'), ircGoneUsersString = "", ircGoneUser; while((ircGoneUser = ircGoneUsersRegex.exec(whoData[0])) !== null){ircGoneUsersString=ircGoneUsersString+ircGoneUser[1]+", ";}botF.sendCommandPRIVMSG("Away users are: "+ircGoneUsersString.replace(/, $/, ".").replace(/^$/, 'No users are away.'), data.responseTarget);});},
	randomlittleface: function (data) {getRandomLittleFace(data.responseTarget);},
	np: function (data) {printRadioStatus(data.responseTarget);},
	raw: function (data) {if(isOp(data.ircData[1]) === true) {botObj.ircConnection.write(data.ircMessageARGS[1]+'\r\n');}},
	savesettings: function (data) {if(isOp(data.ircData[1]) === true) {botF.botSettingsSave(null, null, function () {botF.sendCommandPRIVMSG('Settings saved!', data.responseTarget);});}},
	join: function (data) {if(isOp(data.ircData[1]) === true) {settings.channels.arrayValueAdd(data.ircMessageARGS[1]);}},
	part: function (data) {if(isOp(data.ircData[1]) === true) {settings.channels.arrayValueRemove(data.ircMessageARGS[1]);botF.sendCommandPART(data.ircMessageARGS[1], data.ircMessageARGS[2]);} else if (isChanOp(data.ircData[1], data.responseTarget) === true && pluginSettings.opUsers_commandsAllowChanOp) {settings.channels.arrayValueRemove(data.responseTarget);botF.sendCommandPART(data.responseTarget);}},
	login: function (data) {botF.sendCommandPRIVMSG(authenticateOp(data.ircData[1], data.ircMessageARGS[1]), data.responseTarget);},
	logout: function (data) {botF.sendCommandPRIVMSG(deAuthenticateOp(data.ircData[1]), data.responseTarget);},
	op: function (data) {if(isOp(data.ircData[1]) === true) {botF.sendCommandPRIVMSG(giveOp(data.ircMessageARGS[1]), data.responseTarget);}},
	deop: function (data) {if(isOp(data.ircData[1]) === true) {botF.sendCommandPRIVMSG(takeOp(data.ircMessageARGS[1]), data.responseTarget);}},
	helpall: function (data) {ircSendEntireHelpToUser(data.ircData[1]);},
	responseadd: function (data) {if(isOp(data.ircData[1]) === true) {pluginSettings.specificResponses[data.ircMessageARGS[1]]=data.ircMessageARGS[2];}},
	responseremove: function (data) {if(isOp(data.ircData[1]) === true) {delete pluginSettings.specificResponses[data.ircMessageARGS[1]];}},
	responselist: function (data) {if(isOp(data.ircData[1]) === true) {var specificResponseList=""; for (var specificResponse in pluginSettings.specificResponses) {specificResponseList+="\""+specificResponse+"\", ";}botF.sendCommandPRIVMSG("Current responses are: "+specificResponseList.replace(/, $/, ".").replace(/^$/, 'No responses found.'), data.responseTarget);}},
	reponseclear: function (data) {if(isOp(data.ircData[1]) === true) {pluginSettings.specificResponses = {};}},
	functionadd: function (data) {if(isOp(data.ircData[1]) === true) {pluginSettings.dynamicFunctions[data.ircMessageARGS[1]]=data.ircMessageARGS[2];}},
	functionremove: function (data) {if(isOp(data.ircData[1]) === true) {delete pluginSettings.dynamicFunctions[data.ircMessageARGS[1]];}},
	functionlist: function (data) {if(isOp(data.ircData[1]) === true) {var dynamicFunctionList=""; for (var dynamicFunction in pluginSettings.dynamicFunctions) {dynamicFunctionList+="\""+dynamicFunction+"\", ";}botF.sendCommandPRIVMSG("Current functions are: "+dynamicFunctionList.replace(/, $/, ".").replace(/^$/, 'No dynamic functions found.'), data.responseTarget);}},
	functionshow: function (data) {if(isOp(data.ircData[1]) === true) {var dynamicFunction; if ((dynamicFunction = pluginSettings.dynamicFunctions[data.ircMessageARGS[1]]) !== undefined) {botF.sendCommandPRIVMSG(dynamicFunction, data.responseTarget);}else{botF.sendCommandPRIVMSG("Error: Function not found", data.responseTarget);}}}
};

module.exports.botPluggableFunctionObject = {
	whereis: function (data) {var commandArgsWhereis; if ((commandArgsWhereis = new RegExp('^'+pluginSettings.commandPrefix+'where(?:.*)*?(?=is)is ([^ ]*)', 'g').exec(data.ircData[3])) !== null) {botF.sendCommandWHOIS(commandArgsWhereis[1], function(whoisData){var channelArray=botF.ircWhoisParseChannels(whoisData), channels=""; for (var channel in channelArray[0]){if(channelArray[0].hasOwnProperty(channel)){channels=channels+channelArray[0][channel]+' ';}}botF.sendCommandPRIVMSG(whoisData[1]+' is on: '+channels.replace(/^$/, 'User not found on any channel'), data.responseTarget);});}},
	hi: function (data) {if (new RegExp('(Hi|Hello|Hey|Hai) '+settings.botName, 'gi').exec(data.ircData[3]) !== null) {botF.sendCommandPRIVMSG('Hi '+data.ircData[1], data.responseTarget);}},
	ctcpversion: function (data) {if (new RegExp('\x01VERSION\x01', 'g').exec(data.ircData[3]) !== null) {botF.sendCommandPRIVMSG("I'm a random bot written for fun, you can see my code here: http://git.mindcraft.si.eu.org/?p=nBot.git", data.responseTarget);}}
};

//reserved functions

//handle "botEvent" from bot (botEvent is used for irc related activity)
module.exports.botEvent = function (event) {
	switch (event.eventName) {
		case 'botIrcConnectionCreated': pluginHandleIrcConnectionCreation(event.eventData); break;
		case 'botReceivedPRIVMSG': pluginHandlePRIVMSG(event.eventData); break;
		case 'botReceivedJOIN': pluginHandleJOIN(event.eventData); break;
		case 'botReceivedPART': pluginHandlePART(event.eventData); break;
		case 'botReceivedQUIT': pluginHandleQUIT(event.eventData); break;
		case 'botReceivedKICK': pluginHandleKICK(event.eventData); break;
	}
};

//main function called when plugin is loaded
module.exports.main = function (passedData) {
	//update variables
	botObj = passedData.botObj;
	botF = botObj.publicData.botFunctions;
	settings = botObj.publicData.settings;
	pluginSettings = settings.pluginsSettings[passedData.id];
	ircChannelUsers = botObj.publicData.ircChannelUsers;
	
	//if plugin settings are not defined, define them
	if (pluginSettings === undefined) {
		pluginSettings = new settingsConstructor();
		settings.pluginsSettings[passedData.id] = pluginSettings;
		botF.botSettingsSave();
	}
};
