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
var net = require('net');
var fs = require('fs');
var util = require('util');
var events = require('events');
var sys = require('sys');
var exec = require('child_process').exec;
var path = require('path');
var vm = require('vm');

var pluginDisabled = false;

//main plugin object
var pluginObj = {
	handleNewConnection: function (ircConnection) {
		ircConnection.setTimeout(60*1000);
		ircConnection.once('error', function (e) {
			if (!pluginDisabled) {
				ircConnection.end();
				ircConnection.destroy();
				botF.debugMsg("Got error: "+e.message);
			}
		});
		ircConnection.once('timeout', function (e) {
			if (!pluginDisabled) {
				ircConnection.end();
				ircConnection.destroy();
				botF.debugMsg('connection timeout');
			}
		});
		ircConnection.once('close', function() {
			if (!pluginDisabled) {
				setTimeout(function() {
					if (!pluginDisabled) {botF.initIrcBot();}
				}, 3000);
			}
		});
	},
};

//exports
module.exports.plugin = pluginObj;

//reserved functions

//reserved functions: handle "botEvent" from bot (botEvent is used for irc related activity)
module.exports.botEvent = function (event) {
	switch (event.eventName) {
		case 'botIrcConnectionCreated': pluginObj.handleNewConnection(event.eventData); break;
		case 'botPluginDisableEvent': if (event.eventData == pluginId) {pluginDisabled = true;} break;
	}
};

//reserved functions: main function called when plugin is loaded
module.exports.main = function (passedData) {
	//update variables
	botObj = passedData.botObj;
	pluginId = passedData.id;
	botF = botObj.publicData.botFunctions;
	botV = botObj.publicData.botVariables;
	settings = botObj.publicData.settings;
	pluginSettings = settings.pluginsSettings[pluginId];
	ircChannelUsers = botObj.publicData.ircChannelUsers;
};
