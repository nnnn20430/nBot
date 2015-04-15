/*jshint node: true*/

"use strict";
//variables
var http = require('http');
var net = require('net');
var exec = require('child_process').exec;
var events = require('events');
var url = require('url');

var botObj;
var pluginId;
var botF;
var settings;
var pluginSettings;
var ircChannelUsers;
var plugin = module.exports;
var pluginFuncObj;
var authenticatedOpUsers = [];
var addedBotSimpleCommandsOrigin = {};

//settings constructor
var settingsConstructor = function (modified) {
	var settings, attrname;
	if (this!==settingsConstructor) {
		settings = {
			command_request_maxBytes: 1024,
			radioStatus_mpdServer: 'localhost',
			radioStatus_mpdServerPort: 6600,
			opUsers: { 'nnnn20430': '' },
			opUsers_commandsAllowChanOp: false,
			commandPrefix: '.',
			commandPrefixIgnoreOnDirect: false,
			handleConnectionErrors: true,
			reactToJoinPart: true,
			specificResponses: {},
			dynamicFunctions: {}
		};
		for (attrname in modified) {settings[attrname]=modified[attrname];}
		return settings;
	}
};

//misc plugin functions

//misc plugin functions: ping the server by connecting and quickly closing
function pingTcpServer(host, port, callback){
	var isFinished = false;
	function returnResults(data) {if (!isFinished) {callback(data); isFinished = true;}}
	var pingHost = net.connect({port: port, host: host}, function () {
		returnResults(true);
		pingHost.end();pingHost.destroy();
	});
	pingHost.setTimeout(5*1000);
	pingHost.on('timeout', function () {pingHost.end();pingHost.destroy();returnResults(false);});
	pingHost.on('error', function () {pingHost.end();pingHost.destroy();returnResults(false);});
	pingHost.on('close', function () {returnResults(false);});
}

//misc plugin functions: return entire help
function getHelpAll() {
	var commandArray = commandHelp('arrayOfCommands'), commandString = "";
	for (var command in commandArray) {
		commandString=commandString+pluginSettings.commandPrefix+commandHelp('commandInfo', commandArray[command])+'\n';
	}
	return 'Help for all commands:\n'+commandString;
}

//misc plugin functions: get random int
function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

//misc plugin functions: is the user op
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

//misc plugin functions: give a user operator status
function giveOp(user, pass) {
	var response = "Unknown error happened";
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

//misc plugin functions: take operator status from a user
function takeOp(user) {
	var response = "Unknown error happened";
	if (isOp(user, false) === true) {
		delete pluginSettings.opUsers[user];
		authenticatedOpUsers.arrayValueRemove(user);
		response = "Success: User is no longer an Operator";
	} else {
		response = "Error: User is not an Operator";
	}
	return response;
}

//misc plugin functions: authenticate user
function authenticateOp(user, pass, ignorePass) {
	var response = "Unknown error happened";
	if (isOp(user, false) === true && isOp(user) === false) {
		if(pass == pluginSettings.opUsers[user]  && pluginSettings.opUsers[user] !== ""){
			response = "Success: Correct login";
			authenticatedOpUsers.arrayValueAdd(user);
		} else if (pluginSettings.opUsers[user] && ignorePass) {
			response = "Success: Password ignored";
			authenticatedOpUsers.arrayValueAdd(user);
		} else {
			response = "Error: Wrong username or password";
		}
	} else if (isOp(user) === true) {response = "Error: User is already authenticated";}
	return response;
}

//misc plugin functions: de-authenticate user
function deAuthenticateOp(user) {
	var response = "Unknown error happened";
	if (isOp(user) === true) {
		response = "Success: User has been de-authenticated";
		authenticatedOpUsers.arrayValueRemove(user);
	} else {
		response = "Error: User is not authenticated";
	}
	return response;
}

//misc plugin functions: short help message
function getHelp() {
	var helpMessage, commandArray = commandHelp('arrayOfCommands'), commandString = "";
	for (var command in commandArray) {
		commandString = commandString+commandArray[command]+", ";
	}
	commandString = commandString.replace(/, $/, ".");
	helpMessage = 'Commands are prefixed with "'+pluginSettings.commandPrefix+'"\n'+'use '+pluginSettings.commandPrefix+'help "command" to get more info about the command\n'+'Current commands are: '+commandString;
	return helpMessage;
}

//misc plugin functions: is the user op on channel
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

//bot command handle functions: handle simple bot commands
function botSimpleCommandHandle(ircData, ircMessageARGS) {
	var command = ircMessageARGS[0], isCommand = false;
	if (command.substr(0, pluginSettings.commandPrefix.length) == pluginSettings.commandPrefix) {
		command = command.substr(pluginSettings.commandPrefix.length);
		isCommand = true;
	} else if (pluginSettings.commandPrefixIgnoreOnDirect && ircData[2].charAt(0) != '#') {
		isCommand = true;
	}
	if (isCommand === true) {
		var target = ircData[2]; if (new RegExp('^#.*$').exec(ircData[2]) === null) {target = ircData[1];}
		if (plugin.botSimpleCommandObject[command] !== undefined) {
			try {
				plugin.botSimpleCommandObject[command]({ircData: ircData, ircMessageARGS: ircMessageARGS, responseTarget: target});
			} catch (e) {
				botF.debugMsg('Error: Simple bot command "'+command+'" from plugin "'+botSimpleCommandOrigin(command)+'" is erroneous: ('+e+')');
			}
		}
	}
}

//bot command handle functions: add simple bot command (for plugins)
function botSimpleCommandAdd(command, commandFunction, helpString, origin) {
	var response = "Unknown error happened";
	if (plugin.botSimpleCommandObject[command] === undefined) {
		response = "Success: Command added";
		plugin.botSimpleCommandObject[command] = commandFunction;
		if (helpString) {plugin.botCommandHelpArray.arrayValueAdd([command, helpString]);}
		if (origin) {addedBotSimpleCommandsOrigin[command] = origin;}
	} else {
		response = "Error: Command already exists";
	}
	return response;
}

//bot command handle functions: remove simple bot command
function botSimpleCommandRemove(command) {
	var response = "Unknown error happened", index;
	if (plugin.botSimpleCommandObject[command] !== undefined) {
		response = "Success: Command removed";
		delete plugin.botSimpleCommandObject[command];
		for (index in plugin.botCommandHelpArray) {
			if(plugin.botCommandHelpArray.hasOwnProperty(index)) {
				if (plugin.botCommandHelpArray[index][0] == command) {
					plugin.botCommandHelpArray.arrayValueRemove(plugin.botCommandHelpArray[index]);
				}
			}
		}
		if (addedBotSimpleCommandsOrigin[command] !== undefined) {delete addedBotSimpleCommandsOrigin[command];}
	} else {
		response = "Error: Command doesn't exist";
	}
	return response;
}

//bot command handle functions: simple bot command origin
function botSimpleCommandOrigin(command) {
	var response = pluginId;
	if (addedBotSimpleCommandsOrigin[command] !== undefined) {response = addedBotSimpleCommandsOrigin[command];}
	return response;
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
			botF.debugMsg('Error: Dynamic function "'+dynamicFunctionName+'" is erroneous: ('+e+')');
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

//bot event handle functions

//bot event handle functions: handle irc connection creation from bot
function pluginHandleIrcConnectionCreation(ircConnection) {
	if (pluginSettings.handleConnectionErrors) {
		ircConnection.setTimeout(60*1000);
		ircConnection.once('error', function (e) {ircConnection.end(); ircConnection.destroy(); botF.debugMsg("Got error: "+e.message);});
		ircConnection.once('timeout', function (e) {ircConnection.end(); ircConnection.destroy(); botF.debugMsg('connection timeout');});
		ircConnection.once('close', function() {setTimeout(function() {botF.initIrcBot();}, 3000);});
	}
}

//bot event handle functions: handle PRIVMSG from bot
function pluginHandlePRIVMSG(data) {
	var rawmsg = data[0], from = data[1].split('!')[0], to = data[4], message = data[5];
	var ircMessageARGS = botF.getArgsFromString(message)[0];
	var target = to; if (new RegExp('^#.*$').exec(to) === null) {target = from;}
	//process commands and such
	botSimpleCommandHandle([rawmsg, from, to, message], ircMessageARGS);
	botDynamicFunctionHandle([rawmsg, from, to, message], ircMessageARGS);
	botPluggableFunctionHandle([rawmsg, from, to, message], ircMessageARGS);
	var specificResponse; if ((specificResponse = pluginSettings.specificResponses[message]) !== undefined) {botF.ircSendCommandPRIVMSG(specificResponse, target);}
}

//bot event handle functions: handle JOIN from bot
function pluginHandleJOIN(data) {
	var nick = data[1].split('!')[0];
	var channel = data[5]||data[3];
	if (nick != settings.botName){
		if (pluginSettings.reactToJoinPart === true) {
			botF.ircSendCommandPRIVMSG('Welcome '+nick+' to channel '+channel, channel);
			if(nick == "nnnn20430"){botF.ircSendCommandPRIVMSG('My Creator is here!!!', channel);}
		}
	}
}

//bot event handle functions: handle PART from bot
function pluginHandlePART(data) {
	var nick = data[1].split('!')[0];
	var channel = data[5]||data[3];
	if (nick != settings.botName){
		if (pluginSettings.reactToJoinPart === true) {
			botF.ircSendCommandPRIVMSG('Goodbye '+nick, channel);
		}
		if(isOp(nick)){authenticatedOpUsers.arrayValueRemove(nick);botF.ircSendCommandPRIVMSG('You have left a channel with '+settings.botName+' in it you have been de-authenticated', nick);}
	}
}

//bot event handle functions: handle QUIT from bot
function pluginHandleQUIT(data) {
	var nick = data[1].split('!')[0];
	if (nick != settings.botName){
		if(isOp(nick)){authenticatedOpUsers.arrayValueRemove(nick);}
		for (var channel in ircChannelUsers) {
			if (ircChannelUsers[channel][nick] !== undefined) {
				if (pluginSettings.reactToJoinPart === true) {
					botF.ircSendCommandPRIVMSG('Goodbye '+nick, channel);
				}
			}
		}
	}
}

//bot event handle functions: handle KICK from bot
function pluginHandleKICK(data) {
	var nick = data[3].split(' ')[1];
	var channel = data[3].split(' ')[0];
	if (nick != settings.botName){
		if(isOp(nick)){authenticatedOpUsers.arrayValueRemove(nick);botF.ircSendCommandPRIVMSG('You have been kicked from a channel with '+settings.botName+' in it you have been de-authenticated', nick);}
	}
}

//export functions
pluginFuncObj = {
	pingTcpServer: pingTcpServer,
	getHelpAll: getHelpAll,
	getRandomInt: getRandomInt,
	isOp: isOp,
	giveOp: giveOp,
	takeOp: takeOp,
	getHelp: getHelp,
	isChanOp: isChanOp,
	commandHelp: commandHelp,
	botSimpleCommandHandle: botSimpleCommandHandle,
	botSimpleCommandAdd: botSimpleCommandAdd,
	botSimpleCommandRemove: botSimpleCommandRemove,
	botSimpleCommandOrigin: botSimpleCommandOrigin,
	botDynamicFunctionHandle: botDynamicFunctionHandle
};
for (var name in pluginFuncObj) {module.exports[name] = pluginFuncObj[name];}

//bot simple commands help object
module.exports.botCommandHelpArray = [
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
	['functionadd', 'functionadd "name" "code": add a function named name with node.js code (op only)(the function is passed variables data=["rawmsg","nick","msgtarget","txt"] and ircMessageARGS which is an array with txt interpreted as arguments)'],
	['functionremove', 'functionremove "name": remove a function named name (op only)'],
	['functionlist', 'functionlist: prints list of functions (op only)'],
	['functionshow', 'functionshow "name": prints the code of function named name (op only)'],
	['pluginreload', 'pluginreload "id": reload plugin with id (op only)'],
	['pluginreloadall', 'pluginreloadall: reload all plugins (op only)']
];

//bot simple commands object
module.exports.botSimpleCommandObject = {
	hug: function (data) {botF.ircSendCommandPRIVMSG('*Hugs '+data.ircData[1]+'*', data.responseTarget);},
	echo: function (data) {botF.ircSendCommandPRIVMSG(data.ircMessageARGS[1].replaceSpecialChars(), data.responseTarget);},
	sendmsg: function (data) {botF.ircSendCommandPRIVMSG(data.ircMessageARGS[2].replaceSpecialChars(), data.ircMessageARGS[1]);},
	view: function (data) {if (data.ircMessageARGS[1].substr(0, 'http'.length) == 'http') {http.get(url.parse(data.ircMessageARGS[1], true), function(res) {var resData = ''; res.setEncoding('utf8'); res.on('data', function (chunk) {resData += chunk;}); res.on('end', function () {if(resData.length < pluginSettings.command_request_maxBytes){botF.ircSendCommandPRIVMSG(resData, data.responseTarget);}});}).on('error', function(e) {botF.ircSendCommandPRIVMSG("Got error: "+e.message, data.responseTarget);});}},
	ping: function (data) {pingTcpServer(data.ircMessageARGS[1], data.ircMessageARGS[2], function (status) {var statusString; if(status){statusString="open";}else{statusString="closed";}botF.ircSendCommandPRIVMSG("Port "+data.ircMessageARGS[2]+" on "+data.ircMessageARGS[1]+" is: "+statusString, data.responseTarget);});},
	nbot: function (data) {botF.ircSendCommandPRIVMSG("I'm a random bot written for fun, you can see my code here: http://git.mindcraft.si.eu.org/?p=nBot.git", data.responseTarget);},
	help: function (data) {if(data.ircMessageARGS[1] !== undefined){botF.ircSendCommandPRIVMSG(commandHelp("commandInfo", data.ircMessageARGS[1]), data.responseTarget);}else{botF.ircSendCommandPRIVMSG(getHelp(), data.responseTarget);}},
	away: function (data) {botF.ircUpdateUsersInChannel(data.responseTarget, function (userData) {var ircGoneUsersString = "", user; for (user in userData) {if (!userData[user].isHere) {ircGoneUsersString +=user+", ";}} botF.ircSendCommandPRIVMSG("Away users are: "+ircGoneUsersString.replace(/, $/, ".").replace(/^$/, 'No users are away.'), data.responseTarget);});},
	userlist: function (data) {if (data.ircMessageARGS[1] == 'update') {botF.ircUpdateUsersInChannel(data.responseTarget);} else if (data.ircMessageARGS[1] == 'count') {botF.ircSendCommandPRIVMSG(Object.keys(botObj.publicData.ircChannelUsers[data.responseTarget]).length, data.responseTarget);} else {var nickList = '', nickTotal = 0, channelUsersObj = botObj.publicData.ircChannelUsers[data.responseTarget]; for (var user in channelUsersObj) {nickList += channelUsersObj[user].mode+user+', '; nickTotal++;} nickList = nickList.replace(/, $/, ". "); nickList += '(Nick total: '+nickTotal+')'; botF.ircSendCommandPRIVMSG(nickList, data.responseTarget);}},
	origin: function (data) {if (plugin.botSimpleCommandObject[data.ircMessageARGS[1]] !== undefined) {botF.ircSendCommandPRIVMSG('Command "'+data.ircMessageARGS[1]+'" is from plugin "'+botSimpleCommandOrigin(data.ircMessageARGS[1])+'"', data.responseTarget);}},
	raw: function (data) {if(isOp(data.ircData[1]) === true) {botObj.ircConnection.write(data.ircMessageARGS[1]+'\r\n');}},
	savesettings: function (data) {if(isOp(data.ircData[1]) === true) {botF.botSettingsSave(null, null, function () {botF.ircSendCommandPRIVMSG('Settings saved!', data.responseTarget);});}},
	join: function (data) {if(isOp(data.ircData[1]) === true) {settings.channels.arrayValueAdd(data.ircMessageARGS[1]);}},
	part: function (data) {if(isOp(data.ircData[1]) === true) {settings.channels.arrayValueRemove(data.ircMessageARGS[1]);botF.ircSendCommandPART(data.ircMessageARGS[1], data.ircMessageARGS[2]);} else if (isChanOp(data.ircData[1], data.responseTarget) === true && pluginSettings.opUsers_commandsAllowChanOp) {settings.channels.arrayValueRemove(data.responseTarget);botF.ircSendCommandPART(data.responseTarget);}},
	login: function (data) {botF.ircSendCommandPRIVMSG(authenticateOp(data.ircData[1], data.ircMessageARGS[1]), data.responseTarget);},
	logout: function (data) {botF.ircSendCommandPRIVMSG(deAuthenticateOp(data.ircData[1]), data.responseTarget);},
	op: function (data) {if(isOp(data.ircData[1]) === true) {botF.ircSendCommandPRIVMSG(giveOp(data.ircMessageARGS[1], data.ircMessageARGS[2]), data.responseTarget);}},
	deop: function (data) {if(isOp(data.ircData[1]) === true) {botF.ircSendCommandPRIVMSG(takeOp(data.ircMessageARGS[1]), data.responseTarget);}},
	helpall: function (data) {botF.ircSendCommandPRIVMSG(getHelpAll(), data.ircData[1]);},
	responseadd: function (data) {if(isOp(data.ircData[1]) === true) {pluginSettings.specificResponses[data.ircMessageARGS[1]]=data.ircMessageARGS[2];}},
	responseremove: function (data) {if(isOp(data.ircData[1]) === true) {delete pluginSettings.specificResponses[data.ircMessageARGS[1]];}},
	responselist: function (data) {if(isOp(data.ircData[1]) === true) {var specificResponseList=""; for (var specificResponse in pluginSettings.specificResponses) {specificResponseList+="\""+specificResponse+"\", ";}botF.ircSendCommandPRIVMSG("Current responses are: "+specificResponseList.replace(/, $/, ".").replace(/^$/, 'No responses found.'), data.responseTarget);}},
	reponseclear: function (data) {if(isOp(data.ircData[1]) === true) {pluginSettings.specificResponses = {};}},
	functionadd: function (data) {if(isOp(data.ircData[1]) === true) {pluginSettings.dynamicFunctions[data.ircMessageARGS[1]]=data.ircMessageARGS[2];}},
	functionremove: function (data) {if(isOp(data.ircData[1]) === true) {delete pluginSettings.dynamicFunctions[data.ircMessageARGS[1]];}},
	functionlist: function (data) {if(isOp(data.ircData[1]) === true) {var dynamicFunctionList=""; for (var dynamicFunction in pluginSettings.dynamicFunctions) {dynamicFunctionList+="\""+dynamicFunction+"\", ";}botF.ircSendCommandPRIVMSG("Current functions are: "+dynamicFunctionList.replace(/, $/, ".").replace(/^$/, 'No dynamic functions found.'), data.responseTarget);}},
	functionshow: function (data) {if(isOp(data.ircData[1]) === true) {var dynamicFunction; if ((dynamicFunction = pluginSettings.dynamicFunctions[data.ircMessageARGS[1]]) !== undefined) {botF.ircSendCommandPRIVMSG(dynamicFunction, data.responseTarget);}else{botF.ircSendCommandPRIVMSG("Error: Function not found", data.responseTarget);}}},
	pluginreload: function (data) {if(isOp(data.ircData[1]) === true) {if (botObj.pluginData[data.ircMessageARGS[1]]) {botF.botPluginDisable(data.ircMessageARGS[1]);botF.botPluginLoad(data.ircMessageARGS[1], settings.pluginDir+'/'+data.ircMessageARGS[1]+'.js');}}},
	pluginreloadall: function (data) {function pluginReload(plugin) {botF.botPluginDisable(plugin);botF.botPluginLoad(plugin, settings.pluginDir+'/'+plugin+'.js');} if(isOp(data.ircData[1]) === true) {pluginReload(pluginId); for (var plugin in botObj.pluginData) {if (plugin != 'core') {pluginReload(plugin);}}}}
};

//bot pluggable functions object
module.exports.botPluggableFunctionObject = {
	whereis: function (data) {var commandArgsWhereis; if ((commandArgsWhereis = new RegExp('^'+pluginSettings.commandPrefix+'where(?:.*)*?(?=is)is ([^ ]*)', 'g').exec(data.ircData[3])) !== null) {botF.ircSendCommandWHOIS(commandArgsWhereis[1], function(whoisData){var channels = ''; for (var line in whoisData[1]) {if (whoisData[1][line][2] == 319) {channels += whoisData[1][line][5].replace(/[^ #]{0,1}#/g, '#');}} var channelArray = channels.split(' '); channels = channelArray.join(' '); botF.ircSendCommandPRIVMSG(commandArgsWhereis[1]+' is on: '+channels.replace(/^$/, 'User not found on any channel'), data.responseTarget);});}},
	hi: function (data) {if (new RegExp('(Hi|Hello|Hey|Hai) '+settings.botName, 'gi').exec(data.ircData[3]) !== null) {botF.ircSendCommandPRIVMSG('Hi '+data.ircData[1], data.responseTarget);}},
	ctcpversion: function (data) {if (new RegExp('\x01VERSION\x01', 'g').exec(data.ircData[3]) !== null) {botF.ircSendCommandPRIVMSG("I'm a random bot written for fun, you can see my code here: http://git.mindcraft.si.eu.org/?p=nBot.git", data.responseTarget);}}
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
	pluginId = passedData.id;
	botF = botObj.publicData.botFunctions;
	settings = botObj.publicData.settings;
	pluginSettings = settings.pluginsSettings[pluginId];
	ircChannelUsers = botObj.publicData.ircChannelUsers;
	
	//if plugin settings are not defined, define them
	if (pluginSettings === undefined) {
		pluginSettings = new settingsConstructor();
		settings.pluginsSettings[pluginId] = pluginSettings;
		botF.botSettingsSave();
	}
};
