// Copyright (C) 2015  nnnn20430 (nnnn20430@mindcraft.si.eu.org)
//
// This file is part of nBot.
//
// nBot is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// nBot is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/*jshint node: true*/
/*jshint evil: true*/

"use strict";
//reserved nBot variables
var botObj;
var pluginId;
var botF;
var botV;
var settings;
var pluginSettings;
var ircChannelUsers;

//variables
var http = require('http');
var https = require('https');
var net = require('net');
var exec = require('child_process').exec;
var events = require('events');
var url = require('url');

//settings constructor
var SettingsConstructor = function (modified) {
	var settings, attrname;
	if (this!==SettingsConstructor) {
		settings = {
			command_request_maxBytes: 1024,
			radioStatus_mpdServer: 'localhost',
			radioStatus_mpdServerPort: 6600,
			opUsers: { 'nnnn20430': '' },
			opUsers_commandsAllowChanOp: false,
			opUsers_disabled: false,
			commandPrefix: '.',
			commandPrefixIgnoreOnDirect: true,
			reactToJoinPart: true,
			disabledPluginRemoveCommands: true,
			specificResponses: {},
			dynamicFunctions: {}
		};
		for (attrname in modified) {settings[attrname]=modified[attrname];}
		return settings;
	}
};

//main plugin object
var pluginObj = {
	//variables
	authenticatedOpUsers: [],
	commandsOriginObj: {},
	netsplitData: [[false, false], {}, {}],
	
	//misc plugin functions
	
	//misc plugin functions: ping the server by connecting and quickly closing
	pingTcpServer: function (host, port, callback){
		var isFinished = false;
		var timeA, timeB = new Date().getTime();
		function returnResults(status, info) {if (!isFinished) {callback(status, info); isFinished = true;}}
		if (port > 0 && port < 65536) {
			var pingHost = net.connect({port: port, host: host}, function () {
				timeA = new Date().getTime();
				returnResults(true, timeA-timeB);
				pingHost.end();pingHost.destroy();
			});
			pingHost.setTimeout(5*1000);
			pingHost.on('timeout', function () {pingHost.end();pingHost.destroy();returnResults(false, 'timeout');});
			pingHost.on('error', function (e) {pingHost.end();pingHost.destroy();returnResults(false, 'error: ('+e+')');});
			pingHost.on('close', function () {returnResults(false, 'closed');});
		} else {returnResults(false, 'error: port out of range');}
	},
	
	//misc plugin functions: return entire help
	getHelpAll: function () {
		var commandArray = pluginObj.commandHelp('arrayOfCommands'), commandString = "";
		for (var command in commandArray) {
			commandString=commandString+pluginSettings.commandPrefix+pluginObj.commandHelp('commandInfo', commandArray[command])+'\n';
		}
		return 'Help for all commands:\n'+commandString;
	},
	
	//misc plugin functions: get random int
	getRandomInt: function (min, max) {
	    return Math.floor(Math.random() * (max - min + 1)) + min;
	},
	
	//misc plugin functions: is the user op
	isOp: function (user, checkAuth){
		var isOpUser = false;
		if (checkAuth === undefined) {checkAuth=true;}
		if (pluginSettings.opUsers[user]) {
			if (checkAuth === true) {
				for (var authenticatedOpUser in pluginObj.authenticatedOpUsers) {
						if (user == pluginObj.authenticatedOpUsers[authenticatedOpUser]) {isOpUser = true;}
				}
			}else if (checkAuth === false){
				isOpUser = true;
			}
		}
		if (pluginSettings.opUsers_disabled) {isOpUser = true;}
		return isOpUser;
	},
	
	//misc plugin functions: give a user operator status
	giveOp: function (user, pass) {
		var response = "Unknown error happened";
		if (!user && !pass) {
			response = "Error: User and password must be defined";
		} else if (pluginObj.isOp(user, false) === false) {
			pluginSettings.opUsers[user]=pass;
			response = "Success: User is now an Operator";
		} else {
			response = "Error: User is already an Operator";
		}
		return response;
	},
	
	//misc plugin functions: take operator status from a user
	takeOp: function (user) {
		var response = "Unknown error happened";
		if (pluginObj.isOp(user, false) === true) {
			delete pluginSettings.opUsers[user];
			pluginObj.authenticatedOpUsers.arrayValueRemove(user);
			response = "Success: User is no longer an Operator";
		} else {
			response = "Error: User is not an Operator";
		}
		return response;
	},
	
	//misc plugin functions: authenticate user
	authenticateOp: function (user, pass, ignorePass) {
		var response = "Unknown error happened";
		if (pluginObj.isOp(user, false) === true && pluginObj.isOp(user) === false) {
			if(pass == pluginSettings.opUsers[user]  && pluginSettings.opUsers[user] !== ""){
				response = "Success: Correct login";
				pluginObj.authenticatedOpUsers.arrayValueAdd(user);
			} else if (pluginSettings.opUsers[user] && ignorePass) {
				response = "Success: Password ignored";
				pluginObj.authenticatedOpUsers.arrayValueAdd(user);
			} else {
				response = "Error: Wrong username or password";
			}
		} else if (pluginObj.isOp(user) === true) {response = "Error: User is already authenticated";}
		return response;
	},
	
	//misc plugin functions: de-authenticate user
	deAuthenticateOp: function (user) {
		var response = "Unknown error happened";
		if (pluginObj.isOp(user) === true) {
			response = "Success: User has been de-authenticated";
			pluginObj.authenticatedOpUsers.arrayValueRemove(user);
		} else {
			response = "Error: User is not authenticated";
		}
		return response;
	},
	
	//misc plugin functions: short help message
	getHelp: function () {
		var helpMessage, commandArray = pluginObj.commandHelp('arrayOfCommands'), commandString = "";
		for (var command in commandArray) {
			commandString = commandString+commandArray[command]+", ";
		}
		commandString = commandString.replace(/, $/, ".");
		helpMessage = 'Commands are prefixed with "'+pluginSettings.commandPrefix+'"\n'+'use '+pluginSettings.commandPrefix+'help "command" to get more info about the command\n'+'Current commands are: '+commandString;
		return helpMessage;
	},
	
	//misc plugin functions: is the user op on channel
	isChanOp: function (user, channel){
		var isUserChanOp = false;
		if (ircChannelUsers[channel] && ircChannelUsers[channel][user] && ircChannelUsers[channel][user].mode) {
			if (ircChannelUsers[channel][user].mode.replace(/^(o|q|h|a)$/, "isOp").indexOf("isOp") != -1 ) {isUserChanOp = true;}
			if (ircChannelUsers[channel][user].isGlobalOP) {isUserChanOp = true;}
		}
		return isUserChanOp;
	},
	
	//misc plugin functions: check if plugin is ready
	pluginReadyCheck: function () {
		if (botObj.pluginData.simpleMsg &&
		botObj.pluginData.simpleMsg.ready) {
			//plugin is ready
			exports.ready = true;
			botF.emitBotEvent('botPluginReadyEvent', pluginId);
		}
	},
	
	//misc plugin functions: add listeners to simpleMsg plugin
	utilizeSimpleMsg: function () {
		var simpleMsg = botObj.pluginData.simpleMsg.plugin;
		simpleMsg.msgListenerAdd(pluginId, 'PRIVMSG', function (data) {
			pluginObj.commandHandle(data);
			pluginObj.dynamicFunctionHandle(data);
			pluginObj.pluggableFunctionHandle(data);
			if (pluginSettings.specificResponses[data.message] !== undefined) {
				botF.ircSendCommandPRIVMSG(pluginSettings.specificResponses[data.message], data.responseTarget);
			}
		});
		
		simpleMsg.msgListenerAdd(pluginId, 'JOIN', function (data) {
			if (data.nick != settings.botName){
				if (pluginSettings.reactToJoinPart === true) {
					var isNetsplit = false;
					if (Object.keys(pluginObj.netsplitData[1]).length) {
						if (pluginObj.netsplitData[1][data.nick]) {
							isNetsplit = true;
							delete pluginObj.netsplitData[1][data.nick];
							if (pluginObj.netsplitData[0][1]) {
								clearTimeout(pluginObj.netsplitData[0][1]);
							}
							pluginObj.netsplitData[0][1] = setTimeout(function () {
								pluginObj.netsplitData[0][1] = false;
								for (var channel in pluginObj.netsplitData[2]) {
									botF.ircSendCommandPRIVMSG('Netsplit over!', channel);
								}
								pluginObj.netsplitData[2] = {};
							}, 2000);
						}
					}
					if (!isNetsplit) {
						botF.ircSendCommandPRIVMSG('Welcome '+data.nick+' to channel '+data.channel, data.channel);
						if (data.nick == "nnnn20430"){botF.ircSendCommandPRIVMSG('My Creator is here!!!', data.channel);}
					}
				}
			}
		});
		
		simpleMsg.msgListenerAdd(pluginId, 'PART', function (data) {
			if (data.nick != settings.botName){
				if (pluginSettings.reactToJoinPart === true) {
					botF.ircSendCommandPRIVMSG('Goodbye '+data.nick, data.channel);
				}
				if(pluginObj.isOp(data.nick)){
					pluginObj.authenticatedOpUsers.arrayValueRemove(data.nick);
					botF.ircSendCommandPRIVMSG('You have left a channel with '+settings.botName+' in it you have been de-authenticated', data.nick);
				}
			}
		});
		
		simpleMsg.msgListenerAdd(pluginId, 'QUIT', function (data) {
			if (data.nick != settings.botName){
				if(pluginObj.isOp(data.nick)){pluginObj.authenticatedOpUsers.arrayValueRemove(data.nick);}
				if (pluginSettings.reactToJoinPart === true) {
					//detect netsplits
					var isNetsplit = false;
					for (var server in botV.ircNetworkServers) {
						if (data.reason.split(' ')[0] == botV.ircNetworkServers[server].mask) {
							isNetsplit = true;
						}
					}
					if (isNetsplit) {
						if (pluginObj.netsplitData[0][0]) {
							clearTimeout(pluginObj.netsplitData[0][0]);
						}
						pluginObj.netsplitData[0][0] = setTimeout(function () {
							pluginObj.netsplitData[0][0] = false;
							for (var channel in pluginObj.netsplitData[2]) {
								botF.ircSendCommandPRIVMSG('Netsplit: '+data.reason.split(' ')[0]+'<=>'+data.reason.split(' ')[1]+'.', channel);
							}
						}, 2000);
						pluginObj.netsplitData[1][data.nick] = true;
						for (var channelS in data.channels) {
							pluginObj.netsplitData[2][data.channels[channelS]] = true;
						}
					} else {
						for (var channel in data.channels) {
							botF.ircSendCommandPRIVMSG('Goodbye '+data.nick, data.channels[channel]);
						}
					}
				}
			}
		});
		
		simpleMsg.msgListenerAdd(pluginId, 'NICK', function (data) {
			if (data.nick != settings.botName){
				if(pluginObj.isOp(data.nick)){
					pluginObj.authenticatedOpUsers.arrayValueRemove(data.nick);
					botF.ircSendCommandPRIVMSG('You have changed your authenticated operator nickname you have been de-authenticated', data.newnick);
				}
			}
		});
		
		simpleMsg.msgListenerAdd(pluginId, 'KICK', function (data) {
			if (data.nick != settings.botName){
				if(pluginObj.isOp(data.nick)){
					pluginObj.authenticatedOpUsers.arrayValueRemove(data.nick);
					botF.ircSendCommandPRIVMSG('You have been kicked from a channel with '+settings.botName+' in it you have been de-authenticated', data.nick);
				}
			}
		});
		
		pluginObj.pluginReadyCheck();
	},
	
	//bot command handle functions
	
	//bot command handle functions: command help manager
	commandHelp: function (purpose, command) {
		var response, index;
		if (purpose == 'arrayOfCommands') {
			var commandArray = [];
			for (index in pluginObj.commandsHelpArray) {
				if(pluginObj.commandsHelpArray.hasOwnProperty(index)) {
					commandArray[index] = pluginObj.commandsHelpArray[index][0];
				}
			}
			response = commandArray;
		}
		if (purpose == 'commandInfo') {
			response = 'Command not found';
			for (index in pluginObj.commandsHelpArray) {
				if(pluginObj.commandsHelpArray.hasOwnProperty(index)) {
					if (pluginObj.commandsHelpArray[index][0] == command) {response = pluginObj.commandsHelpArray[index][1];}
				}
			}
		}
		return response;
	},
	
	//bot command handle functions: handle simple bot commands
	commandHandle: function (data) {
		var command = data.messageARGS[0]||'', isCommand = false;
		if (command.substr(0, pluginSettings.commandPrefix.length) == pluginSettings.commandPrefix) {
			command = command.substr(pluginSettings.commandPrefix.length);
			isCommand = true;
		} else if (pluginSettings.commandPrefixIgnoreOnDirect && data.to.charAt(0) != '#') {
			isCommand = true;
		}
		if (isCommand === true) {
			if (pluginObj.commandsObject[command] !== undefined) {
				try {
					pluginObj.commandsObject[command](data);
				} catch (e) {
					botF.debugMsg('Error: Simple bot command "'+command+'" from plugin "'+pluginObj.getCommandOrigin(command)+'" is erroneous: ('+e+')');
				}
			}
		}
	},
	
	//bot command handle functions: add simple bot command (for plugins)
	commandAdd: function (command, commandFunction, helpString, origin) {
		var response = "Unknown error happened";
		if (pluginObj.commandsObject[command] === undefined) {
			response = "Success: Command added";
			pluginObj.commandsObject[command] = commandFunction;
			if (helpString) {pluginObj.commandsHelpArray.arrayValueAdd([command, helpString]);}
			if (origin) {pluginObj.commandsOriginObj[command] = origin;}
		} else {
			response = "Error: Command already exists";
		}
		return response;
	},
	
	//bot command handle functions: remove simple bot command
	commandRemove: function (command) {
		var response = "Unknown error happened", index;
		if (pluginObj.commandsObject[command] !== undefined) {
			response = "Success: Command removed";
			delete pluginObj.commandsObject[command];
			for (index in pluginObj.commandsHelpArray) {
				if(pluginObj.commandsHelpArray.hasOwnProperty(index)) {
					if (pluginObj.commandsHelpArray[index][0] == command) {
						pluginObj.commandsHelpArray.arrayValueRemove(pluginObj.commandsHelpArray[index]);
					}
				}
			}
			if (pluginObj.commandsOriginObj[command] !== undefined) {delete pluginObj.commandsOriginObj[command];}
		} else {
			response = "Error: Command doesn't exist";
		}
		return response;
	},
	
	//bot command handle functions: simple bot command origin
	getCommandOrigin: function (command) {
		var response = pluginId;
		if (pluginObj.commandsOriginObj[command] !== undefined) {response = pluginObj.commandsOriginObj[command];}
		return response;
	},
	
	//bot command handle functions: remove commands with same origin
	commandsRemoveByOrigin: function (origin) {
		var command;
		for (command in pluginObj.commandsOriginObj) {
			if (pluginObj.commandsOriginObj[command] == origin) {
				pluginObj.commandRemove(command);
			}
		}
	},
	
	//bot command handle functions: handle dynamic bot functions
	dynamicFunctionHandle: function (data) {
		var dynamicFunction;
		for (var dynamicFunctionName in pluginSettings.dynamicFunctions) {
			try {
				dynamicFunction=eval("(function (data) {"+pluginSettings.dynamicFunctions[dynamicFunctionName]+"})");
				dynamicFunction(data);
			} catch (e) {
				botF.debugMsg('Error: Dynamic function "'+dynamicFunctionName+'" is erroneous: ('+e+')');
			}
		}
	},
	
	//bot command handle functions: pluggable functions (to make it easier for plugins to add or remove functions)
	pluggableFunctionHandle: function (data) {
		for (var pluggableFunction in pluginObj.pluggableFunctionObject) {
			pluginObj.pluggableFunctionObject[pluggableFunction](data);
		}
	},
	
	//bot commands help array
	commandsHelpArray: [
		['hug', 'hug: gives you a free hug'],
		['whereis', 'whereis "user": lists the channels the user is in (the command can contain anything between where and is)'],
		['echo', 'echo "string": prints string back to the chat'],
		['sendmsg', 'sendmsg "#channel" "string": prints string on the channel (only if the bot is in it)'],
		['view', 'view "url": prints the data located at the url, data must not be bigger than 1KiB'],
		['ping', 'ping "host" "port": pings the port on host'],
		['nbot', 'nbot: prints some info about nBot'],
		['help', 'help: prints help message'],
		['away', 'away: prints a list of away users in the channel'],
		['userlist', 'userlist [count|update]: prints a list of users on the channel'],
		['origin', 'origin "command": prints plugin origin of a command'],
		['raw', 'raw "raw command": make the bot send a raw command to the irc server (op only)'],
		['savesettings', 'savesettings: save current settings to file (op only)'],
		['join', 'join "#channel": make the bot join the channel (op only)'],
		['part', 'part "#channel": make the bot part the channel (op only)'],
		['login', 'login "password": authenticate as an Operator (op only)(please send this command directly to the bot)'],
		['logout', 'logout: de-authenticate (op only)'],
		['op', 'op "user" "password": give the user Operator status (op only)'],
		['deop', 'deop "user": take Operator status from the user (op only)'],
		['helpall', 'helpall: prints help for all commands to the user'],
		['responseadd', 'responseadd "trigger" "response": add a response to trigger (op only)'],
		['responseremove', 'responseremove "trigger": remove a response from trigger (op only)'],
		['responselist', 'responselist: prints list of responses (op only)'],
		['responseclear', 'responsereclear: remove all set triggered responses (op only)'],
		['functionadd', 'functionadd "name" "code": add a function named name with node.js code (op only)(the function is passed variable data={rawdata, nick, to, message, messageARGS, responseTarget})'],
		['functionremove', 'functionremove "name": remove a function named name (op only)'],
		['functionlist', 'functionlist: prints list of functions (op only)'],
		['functionshow', 'functionshow "name": prints the code of function named name (op only)'],
		['pluginreload', 'pluginreload "id": reload plugin with id (op only)'],
		['pluginreloadall', 'pluginreloadall: reload all plugins (op only)'],
		['evaljs', 'evaljs "code": evaluates node.js code (op only)'],
		['pluginload', 'pluginload "plugin": load a plugin (op only)'],
		['plugindisable', 'plugindisable "plugin": disable a loaded plugin (op only)'],
		['date', 'date [UTC|ISO|UNIX]: get current date'],
		['sh', 'sh "shell expresion": run commands through /bin/sh (op only)'],
		['binary', 'binary ENCODE|DECODE "string"']
	],
	
	//bot commands object
	commandsObject: {
		hug: function (data) {botF.ircSendCommandPRIVMSG('*Hugs '+data.nick+'*', data.responseTarget);},
		echo: function (data) {botF.ircSendCommandPRIVMSG(data.messageARGS[1].replaceSpecialChars(), data.responseTarget);},
		sendmsg: function (data) {botF.ircSendCommandPRIVMSG(data.messageARGS[2].replaceSpecialChars(), data.messageARGS[1]);},
		view: function (data) {var protocol = false; if (data.messageARGS[1].substr(0, 'http://'.length) == 'http://') {protocol = http;} else if (data.messageARGS[1].substr(0, 'https://'.length) == 'https://') {protocol = https;} if(protocol) {protocol.get(url.parse(data.messageARGS[1], true), function(res) {var resData = ''; res.setEncoding('utf8'); res.on('data', function (chunk) {resData += chunk;}); res.on('end', function () {if(resData.length < pluginSettings.command_request_maxBytes){botF.ircSendCommandPRIVMSG(resData, data.responseTarget);}});}).on('error', function(e) {botF.ircSendCommandPRIVMSG("Got error: "+e.message, data.responseTarget);});}},
		ping: function (data) {pluginObj.pingTcpServer(data.messageARGS[1], data.messageARGS[2], function (status, info) {var statusString; if(status){statusString="open";}else{statusString="closed";}botF.ircSendCommandPRIVMSG("Port "+data.messageARGS[2]+" on "+data.messageARGS[1]+" is: "+statusString+", "+(botF.isNumeric(info)?info+"ms":info), data.responseTarget);});},
		nbot: function (data) {botF.ircSendCommandPRIVMSG("I'm a random bot written for fun, you can see my code here: http://git.mindcraft.si.eu.org/?p=nBot.git", data.responseTarget);},
		help: function (data) {if(data.messageARGS[1] !== undefined){botF.ircSendCommandPRIVMSG(pluginObj.commandHelp("commandInfo", data.messageARGS[1]), data.responseTarget);}else{botF.ircSendCommandPRIVMSG(pluginObj.getHelp(), data.responseTarget);}},
		away: function (data) {botF.ircUpdateUsersInChannel(data.responseTarget, function (userData) {var ircGoneUsersString = "", user; userData = userData[data.responseTarget]; for (user in userData) {if (!userData[user].isHere) {ircGoneUsersString +=user+", ";}} botF.ircSendCommandPRIVMSG("Away users are: "+ircGoneUsersString.replace(/, $/, ".").replace(/^$/, 'No users are away.'), data.responseTarget);});},
		userlist: function (data) {if (data.messageARGS[1] == 'update') {botF.ircUpdateUsersInChannel(data.responseTarget);} else if (data.messageARGS[1] == 'count') {botF.ircSendCommandPRIVMSG(Object.keys(botObj.publicData.ircChannelUsers[data.responseTarget]).length, data.responseTarget);} else {var nickList = '', nickTotal = 0, channelUsersObj = botObj.publicData.ircChannelUsers[data.responseTarget]; for (var user in channelUsersObj) {nickList += botF.ircModePrefixConvert('prefix', channelUsersObj[user].mode)+user+', '; nickTotal++;} nickList = nickList.replace(/, $/, ". "); nickList += '(Nick total: '+nickTotal+')'; botF.ircSendCommandPRIVMSG(nickList, data.responseTarget);}},
		origin: function (data) {if (pluginObj.commandsObject[data.messageARGS[1]] !== undefined) {botF.ircSendCommandPRIVMSG('Command "'+data.messageARGS[1]+'" is from plugin "'+pluginObj.getCommandOrigin(data.messageARGS[1])+'"', data.responseTarget);}},
		raw: function (data) {if(pluginObj.isOp(data.nick) === true) {botObj.ircConnection.write(data.messageARGS[1]+'\r\n');}},
		savesettings: function (data) {if(pluginObj.isOp(data.nick) === true) {botF.botSettingsSave(null, null, function () {botF.ircSendCommandPRIVMSG('Settings saved!', data.responseTarget);});}},
		join: function (data) {if(pluginObj.isOp(data.nick) === true) {settings.channels.arrayValueAdd(data.messageARGS[1]);}},
		part: function (data) {if(pluginObj.isOp(data.nick) === true) {settings.channels.arrayValueRemove(data.messageARGS[1]);botF.ircSendCommandPART(data.messageARGS[1], data.messageARGS[2]);} else if (pluginObj.isChanOp(data.nick, data.responseTarget) === true && pluginSettings.opUsers_commandsAllowChanOp) {settings.channels.arrayValueRemove(data.responseTarget);botF.ircSendCommandPART(data.responseTarget);}},
		login: function (data) {botF.ircSendCommandPRIVMSG(pluginObj.authenticateOp(data.nick, data.messageARGS[1]), data.responseTarget);},
		logout: function (data) {botF.ircSendCommandPRIVMSG(pluginObj.deAuthenticateOp(data.nick), data.responseTarget);},
		op: function (data) {if(pluginObj.isOp(data.nick) === true) {botF.ircSendCommandPRIVMSG(pluginObj.giveOp(data.messageARGS[1], data.messageARGS[2]), data.responseTarget);}},
		deop: function (data) {if(pluginObj.isOp(data.nick) === true) {botF.ircSendCommandPRIVMSG(pluginObj.takeOp(data.messageARGS[1]), data.responseTarget);}},
		helpall: function (data) {botF.ircSendCommandPRIVMSG(pluginObj.getHelpAll(), data.nick);},
		responseadd: function (data) {if(pluginObj.isOp(data.nick) === true) {pluginSettings.specificResponses[data.messageARGS[1]]=data.messageARGS[2];}},
		responseremove: function (data) {if(pluginObj.isOp(data.nick) === true) {delete pluginSettings.specificResponses[data.messageARGS[1]];}},
		responselist: function (data) {if(pluginObj.isOp(data.nick) === true) {var specificResponseList=""; for (var specificResponse in pluginSettings.specificResponses) {specificResponseList+="\""+specificResponse+"\", ";}botF.ircSendCommandPRIVMSG("Current responses are: "+specificResponseList.replace(/, $/, ".").replace(/^$/, 'No responses found.'), data.responseTarget);}},
		reponseclear: function (data) {if(pluginObj.isOp(data.nick) === true) {pluginSettings.specificResponses = {};}},
		functionadd: function (data) {if(pluginObj.isOp(data.nick) === true) {pluginSettings.dynamicFunctions[data.messageARGS[1]]=data.messageARGS[2];}},
		functionremove: function (data) {if(pluginObj.isOp(data.nick) === true) {delete pluginSettings.dynamicFunctions[data.messageARGS[1]];}},
		functionlist: function (data) {if(pluginObj.isOp(data.nick) === true) {var dynamicFunctionList=""; for (var dynamicFunction in pluginSettings.dynamicFunctions) {dynamicFunctionList+="\""+dynamicFunction+"\", ";}botF.ircSendCommandPRIVMSG("Current functions are: "+dynamicFunctionList.replace(/, $/, ".").replace(/^$/, 'No dynamic functions found.'), data.responseTarget);}},
		functionshow: function (data) {if(pluginObj.isOp(data.nick) === true) {var dynamicFunction; if ((dynamicFunction = pluginSettings.dynamicFunctions[data.messageARGS[1]]) !== undefined) {botF.ircSendCommandPRIVMSG(dynamicFunction, data.responseTarget);}else{botF.ircSendCommandPRIVMSG("Error: Function not found", data.responseTarget);}}},
		pluginreload: function (data) {if(pluginObj.isOp(data.nick) === true) {if (botObj.pluginData[data.messageARGS[1]]) {botF.botPluginDisable(data.messageARGS[1]);botF.botPluginLoad(data.messageARGS[1], settings.pluginDir+'/'+data.messageARGS[1]+'.js');}}},
		pluginreloadall: function (data) {function pluginReload(plugin) {botF.botPluginDisable(plugin);botF.botPluginLoad(plugin, settings.pluginDir+'/'+plugin+'.js');} if(pluginObj.isOp(data.nick) === true) {pluginReload(pluginId); for (var plugin in botObj.pluginData) {if (plugin != pluginId && plugin != 'simpleMsg') {pluginReload(plugin);}}}},
		evaljs: function (data) {if(pluginObj.isOp(data.nick) === true) {eval("(function () {"+data.messageARGS[1]+"})")();}},
		pluginload: function (data) {if(pluginObj.isOp(data.nick) === true) {botF.botPluginLoad(data.messageARGS[1], settings.pluginDir+'/'+data.messageARGS[1]+'.js');settings.plugins.arrayValueAdd(data.messageARGS[1]);}},
		plugindisable: function (data) {if(pluginObj.isOp(data.nick) === true) {botF.botPluginDisable(data.messageARGS[1]);settings.plugins.arrayValueRemove(data.messageARGS[1]);}},
		date: function (data) {var date = ''; switch (data.messageARGS[1]?data.messageARGS[1].toUpperCase():null) {case 'UTC': date = new Date().toUTCString(); break; case 'ISO': date = new Date().toISOString(); break; case 'UNIX': date = Math.round(new Date().getTime() / 1000); break; default: date = new Date();} botF.ircSendCommandPRIVMSG(date, data.responseTarget);},
		sh: function (data) {if(pluginObj.isOp(data.nick) === true) {exec(data.messageARGS[1], function(error, stdout, stderr){botF.ircSendCommandPRIVMSG(stdout.replace(/\n/g, ' ;; '), data.responseTarget);});}},
		binary: function (data) {var response = '', strArr, i, message = ''; for (i in data.messageARGS) {if (i > 1) {message += ' '+data.messageARGS[i];}} message=message.substr(1); switch (data.messageARGS[1]?data.messageARGS[1].toUpperCase():null) {case 'ENCODE': strArr = message.split(''); for (i in strArr) {response += ' '+('0000000'+parseInt(new Buffer(strArr[i].toString(), 'utf8').toString('hex'), 16).toString(2)).slice(-8);} response=response.substr(1); break; case 'DECODE': message=message.split(' ').join(''); i=0; while (8*(i+1) <= message.length) {response += new Buffer(parseInt(message.substr(8*i, 8), 2).toString(16), 'hex').toString('utf8'); i++;}} botF.ircSendCommandPRIVMSG(response, data.responseTarget);}
	},
	
	//bot pluggable functions object
	pluggableFunctionObject: {
		whereis: function (data) {var commandArgsWhereis; if ((commandArgsWhereis = new RegExp('^'+pluginSettings.commandPrefix+'where(?:.*)*?(?=is)is ([^ ]*)', 'g').exec(data.message)) !== null) {botF.ircSendCommandWHOIS(commandArgsWhereis[1], function(whoisData){var channels = ''; for (var line in whoisData[1]) {if (whoisData[1][line][2] == 319) {channels += whoisData[1][line][5].replace(/[^ #]{0,1}#/g, '#');}} var channelArray = channels.split(' '); channels = channelArray.join(' '); botF.ircSendCommandPRIVMSG(commandArgsWhereis[1]+' is on: '+channels.replace(/^$/, 'User not found on any channel'), data.responseTarget);});}},
		hi: function (data) {if (new RegExp('(Hi|Hello|Hey|Hai) '+settings.botName, 'gi').exec(data.message) !== null) {botF.ircSendCommandPRIVMSG('Hi '+data.nick, data.responseTarget);}},
		ctcpVersion: function (data) {if (new RegExp('\x01VERSION\x01', 'g').exec(data.message) !== null) {botF.ircSendCommandNOTICE("\x01VERSION nBot v0.2.3.7\x01", data.nick);}},
		ctcpPing: function (data) {var timestamp; if ((timestamp = new RegExp('\x01PING ([^\x01]*)\x01', 'g').exec(data.message)) !== null) {botF.ircSendCommandNOTICE("\x01PING "+timestamp[1]+"\x01", data.nick);}},
		ctcpTime: function (data) {if (new RegExp('\x01TIME\x01', 'g').exec(data.message) !== null) {botF.ircSendCommandNOTICE("\x01TIME "+new Date()+"\x01", data.nick);}},
		ctcpClientinfo: function (data) {if (new RegExp('\x01CLIENTINFO\x01', 'g').exec(data.message) !== null) {botF.ircSendCommandNOTICE("\x01CLIENTINFO VERSION PING TIME CLIENTINFO SOURCE\x01", data.nick);}},
		ctcpSource: function (data) {if (new RegExp('\x01SOURCE\x01', 'g').exec(data.message) !== null) {botF.ircSendCommandNOTICE("\x01SOURCE https://phabricator.mindcraft.si.eu.org/diffusion/NBOT/\x01", data.nick);}}
	}
};

//exports
module.exports.plugin = pluginObj;
module.exports.ready = false;

//reserved functions

//handle "botEvent" from bot (botEvent is used for irc related activity)
module.exports.botEvent = function (event) {
	switch (event.eventName) {
		//make sure operator list is clean if new connection is made
		case 'botPluginDisableEvent': if (pluginSettings.disabledPluginRemoveCommands) {pluginObj.commandsRemoveByOrigin(event.eventData);} break;
		case 'botPluginReadyEvent': if (event.eventData == 'simpleMsg') {pluginObj.utilizeSimpleMsg();} break;
	}
};

//main function called when plugin is loaded
module.exports.main = function (passedData) {
	//update variables
	botObj = passedData.botObj;
	pluginId = passedData.id;
	botF = botObj.publicData.botFunctions;
	botV = botObj.publicData.botVariables;
	settings = botObj.publicData.settings;
	pluginSettings = settings.pluginsSettings[pluginId];
	ircChannelUsers = botObj.publicData.ircChannelUsers;
	
	//if plugin settings are not defined, define them
	if (pluginSettings === undefined) {
		pluginSettings = new SettingsConstructor();
		settings.pluginsSettings[pluginId] = pluginSettings;
		botF.botSettingsSave();
	}
	
	//check and utilize dependencies
	if (botObj.pluginData.simpleMsg &&
	botObj.pluginData.simpleMsg.ready) {
		pluginObj.utilizeSimpleMsg();
	}
};
