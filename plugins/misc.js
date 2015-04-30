/*jshint node: true*/
/*jshint evil: true*/

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
			mathHelper: true
		};
		for (attrname in modified) {settings[attrname]=modified[attrname];}
		return settings;
	}
};

//main plugin object
var pluginObj = {
	mainMiscHandle: function (data) {
		if (pluginSettings.mathHelper) {pluginObj.tryArithmeticEquation(data);}
	},
	
	tryArithmeticEquation: function (data) {
		if (data.message.charAt(data.message.length-1) == '=') {
			if (botF.isNumeric(data.message.replace(/(\+|\-|\/|\*|\%|\(|\)|\=)/g, ''))) {
				try {
					botF.ircSendCommandPRIVMSG('='+eval(data.message.substr(0, data.message.length-1)), data.responseTarget);
				} catch (e) {
					botF.ircSendCommandPRIVMSG('Error when evaluating equation: ('+e+')', data.responseTarget);
				}
			}
		}
	}
};

//exports
module.exports.plugin = pluginObj;

//reserved functions

//reserved functions: handle "botEvent" from bot (botEvent is used for irc related activity)
//module.exports.botEvent = function (event) {};

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
	
	//add listeners to simpleMsg plugin
	var simpleMsg = botObj.pluginData.simpleMsg.plugin;
	simpleMsg.msgListenerAdd(pluginId, 'PRIVMSG', function (data) {
		pluginObj.mainMiscHandle(data);
	});
};
