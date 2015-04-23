/*jshint node: true*/

"use strict";
//variables
var http = require('http');
var net = require('net');
var fs = require('fs');
var util = require('util');
var events = require('events');
var sys = require('sys');
var exec = require('child_process').exec;
var path = require('path');

var botObj;
var pluginId;
var botF;
var settings;
var pluginSettings;
var ircChannelUsers;

//settings constructor
var SettingsConstructor = function (modified) {
	var settings, attrname;
	if (this!==SettingsConstructor) {
		settings = {
			disabledPluginRemoveListeners: true
		};
		for (attrname in modified) {settings[attrname]=modified[attrname];}
		return settings;
	}
};

var pluginObj = {
	//variables
	msgListenerObj: {},
	
	//simple message event managing functions
	
	//simple message event managing functions: emit
	msgEmit: function (name, data) {
		for (var id in pluginObj.msgListenerObj) {
			if (pluginObj.msgListenerObj[id][name] !== undefined) {
				for (var handle in pluginObj.msgListenerObj[id][name]) {
					try {
						pluginObj.msgListenerObj[id][name][handle](data);
					} catch (e) {
						botF.debugMsg('Error when emitting "'+name+'" event to listener "'+id+'": ('+e+')');
					}
				}
			}
		}
	},
	
	//simple message event managing functions: add listener
	msgListenerAdd: function (id, name, handle) {
		var response = false;
		if ((id && name && handle) !== undefined) {
			if (pluginObj.msgListenerObj[id] === undefined) {pluginObj.msgListenerObj[id] = {};}
			if (pluginObj.msgListenerObj[id][name] === undefined) {pluginObj.msgListenerObj[id][name] = [];}
			pluginObj.msgListenerObj[id][name].arrayValueAdd(handle);
			response = true;
		}
		return response;
	},
	
	//simple message event managing functions: remove listener
	msgListenerRemove: function (id, name, handle) {
		var response = false;
		if (pluginObj.msgListenerObj[id] !== undefined) {
			if (name !== undefined) {
				if (handle !== undefined) {
					for (var handleFound in pluginObj.msgListenerObj[id][name]) {
						if (handle === pluginObj.msgListenerObj[id][name][handleFound]) {
							delete pluginObj.msgListenerObj[id][name][handleFound];
						}
					}
				} else {
					delete pluginObj.msgListenerObj[id][name];
				}
			} else {
				delete pluginObj.msgListenerObj[id];
			}
			response = true;
		}
		return response;
	},
	
	//message handling functions
	
	//message handling functions: handle PRIVMSG
	msgParsePRIVMSG: function (data, callback) {
		var nick = data[1].split('!')[0], to = data[4], message = data[5];
		var messageARGS = botF.getArgsFromString(message)[0];
		var target = to.charAt(0) == '#' ? to : nick;
		var parsedData = {rawdata: data, nick: nick, to: to, message: message, messageARGS: messageARGS, responseTarget: target};
		if (!callback) {
			pluginObj.msgEmit('PRIVMSG', parsedData);
		} else {
			callback(parsedData);
		}
	},
	
	msgParseNOTICE: function (data, callback) {
		var nick = data[1].split('!')[0], to = data[4], message = data[5];
		var parsedData = {rawdata: data, nick: nick, to: to, message: message};
		if (!callback) {
			pluginObj.msgEmit('NOTICE', parsedData);
		} else {
			callback(parsedData);
		}
	},
	
	//message handling functions: handle JOIN
	msgParseJOIN: function (data, callback) {
		var nick = data[1].split('!')[0];
		var channel = data[5]||data[3];
		var parsedData = {rawdata: data, nick: nick, channel: channel};
		if (!callback) {
			pluginObj.msgEmit('JOIN', parsedData);
		} else {
			callback(parsedData);
		}
	},
	
	//message handling functions: handle PART
	msgParsePART: function (data, callback) {
		var nick = data[1].split('!')[0];
		var channel = data[4]||data[3];
		var reason = data[5];
		var parsedData = {rawdata: data, nick: nick, channel: channel, reason: reason};
		if (!callback) {
			pluginObj.msgEmit('PART', parsedData);
		} else {
			callback(parsedData);
		}
	},
	
	//message handling functions: handle QUIT
	msgParseQUIT: function (data, callback) {
		var nick = data[1].split('!')[0];
		var reason = data[5]||data[3];
		var channels = [];
		for (var channel in ircChannelUsers) {
			if (ircChannelUsers[channel][nick] !== undefined) {
				channels.arrayValueAdd(channel);
			}
		}
		var parsedData = {rawdata: data, nick: nick, reason: reason, channels: channels};
		if (!callback) {
			pluginObj.msgEmit('QUIT', parsedData);
		} else {
			callback(parsedData);
		}
	},
	
	//message handling functions: handle MODE
	msgParseMODE: function(data, callback) {
		var by = data[1].split('!')[0];
		var modeParams = data[3].split(' ');
		var parsedData;
		if (modeParams.length == 3) {
			if(modeParams[1].charAt(0) == '+' || modeParams[1].charAt(0) == '-') {
				if (modeParams[1].charAt(0) == '+') {
					parsedData = {rawdata: data, by: by, target: modeParams[0], mode: modeParams[1].substr(1), param: modeParams[2]};
					if (!callback) {
						pluginObj.msgEmit('+MODE', parsedData);
					} else {
						callback(parsedData);
					}
				}
				if (modeParams[1].charAt(0) == '-') {
					parsedData = {rawdata: data, by: by, target: modeParams[0], mode: modeParams[1].substr(1), param: modeParams[2]};
					if (!callback) {
						pluginObj.msgEmit('-MODE', parsedData);
					} else {
						callback(parsedData);
					}
				}
			}
		}
	},
	
	//message handling functions: handle NICK
	msgParseNICK: function (data, callback) {
		var nick = data[1].split('!')[0];
		var newnick = data[3];
		var channels = [];
		for (var channel in ircChannelUsers) {
			if (ircChannelUsers[channel][nick] !== undefined) {
				channels.arrayValueAdd(channel);
			}
		}
		var parsedData = {rawdata: data, nick: nick, newnick: newnick, channels: channels};
		if (!callback) {
			pluginObj.msgEmit('NICK', parsedData);
		} else {
			callback(parsedData);
		}
	},
	
	//message handling functions: handle KICK
	msgParseKICK: function (data, callback) {
		var by = data[1].split('!')[0];
		var channel = data[3].split(' ')[0];
		var nick = data[3].split(' ')[1];
		var reason = data[5];
		var parsedData = {rawdata: data, by: by, channel: channel, nick: nick, reason: reason};
		if (!callback) {
			pluginObj.msgEmit('KICK', parsedData);
		} else {
			callback(parsedData);
		}
	},
	
	//message handling functions: handle TOPIC
	msgParseTOPIC: function (data, callback) {
		var nick = data[1].split('!')[0];
		var channel = data[3].split(' ')[0];
		var topic = data[5];
		var parsedData = {rawdata: data, nick: nick, channel: channel, topic: topic};
		if (!callback) {
			pluginObj.msgEmit('TOPIC', parsedData);
		} else {
			callback(parsedData);
		}
	},
	
	msgParseNum005: function (data, callback) {
		//fix me
	},
	
	msgParseNum311: function (data, callback) {
		//fix me
	},
	
	msgParseNum352: function (data, callback) {
		//fix me
	},
	
	msgParseNum353: function (data, callback) {
		var channel = data[1][0][4];
		var nicks = {};
		var supportedPrefixes = "@+";
		for (var prefix in botObj.publicData.botPrivateData.ircSupportedUserModesArray) {
			supportedPrefixes += botObj.publicData.botPrivateData.ircSupportedUserModesArray[prefix][1];
		}
		for (var line in data[1]) {
			var nickArray = data[1][line][5].split(' ');
			for (var nick in nickArray) {
				var hasPrefix = (supportedPrefixes.indexOf(nickArray[nick].charAt(0)) != -1) ? 1 : 0;
				nicks[nickArray[nick].substr(hasPrefix)] = nickArray[nick].substr(0, hasPrefix);
			}
		}
		var parsedData = {rawdata: data, channel: channel, nicks: nicks};
		if (!callback) {
			pluginObj.msgEmit('RPL_NAMREPLY', parsedData);
		} else {
			callback(parsedData);
		}
	}
};

//exports
module.exports.plugin = pluginObj;

//reserved functions

//reserved functions: handle "botEvent" from bot (botEvent is used for irc related activity)
module.exports.botEvent = function (event) {
	var suffix;
	if (event.eventName.substr(0, 'botReceived'.length) == 'botReceived') {
		suffix = event.eventName.substr('botReceived'.length);
		if (pluginObj['msgParse'+suffix] !== undefined) {
			pluginObj['msgParse'+suffix](event.eventData);
		}
	}
	switch (event.eventName) {
		case 'botPluginDisableEvent': if (pluginSettings.disabledPluginRemoveListeners) {pluginObj.msgListenerRemove(event.eventData);} break;
		case 'botReceivedDataParsedLine': pluginObj.msgEmit('RAW', event.eventData); break;
	}
};

//reserved functions: main function called when plugin is loaded
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
		pluginSettings = new SettingsConstructor();
		settings.pluginsSettings[pluginId] = pluginSettings;
		botF.botSettingsSave();
	}
};
