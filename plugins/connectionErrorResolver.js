// Copyright (C) 2015, 2016  nnnn20430 (nnnn20430@mindcraft.si.eu.org)
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
var bot;
var pluginId;
var settings;
var pluginSettings;
var ircChannelUsers;

//variables
var http = require('http');
var net = require('net');
var fs = require('fs');
var util = require('util');
var events = require('events');
var exec = require('child_process').exec;
var path = require('path');
var vm = require('vm');

var pluginDisabled = false;

//main plugin object
var plugin = {
	handleNewConnection: function (ircConnection) {
		ircConnection.setTimeout(60*1000);
		ircConnection.once('error', function (e) {
			if (!pluginDisabled) {
				ircConnection.end();
				ircConnection.destroy();
			}
		});
		ircConnection.once('timeout', function (e) {
			if (!pluginDisabled) {
				ircConnection.end();
				ircConnection.destroy();
			}
		});
		ircConnection.once('close', function() {
			if (!pluginDisabled) {
				setTimeout(function() {
					if (!pluginDisabled) {bot.init();}
				}, 3000);
			}
		});
	},
};

//exports
module.exports.plugin = plugin;
module.exports.ready = false;

//reserved functions

//reserved functions: handle "botEvent" from bot (botEvent is used for irc related activity)
module.exports.botEvent = function (event) {
	switch (event.eventName) {
		case 'botIrcConnectionCreated': plugin.handleNewConnection(event.eventData); break;
		case 'botPluginDisableEvent': if (event.eventData == pluginId) {pluginDisabled = true;} break;
	}
};

//reserved functions: main function called when plugin is loaded
module.exports.main = function (i, b) {
	//update variables
	bot = b;
	pluginId = i;
	settings = bot.options;
	pluginSettings = settings.pluginsSettings[pluginId];
	ircChannelUsers = bot.ircChannelUsers;
	
	//plugin is ready
	exports.ready = true;
	bot.emitBotEvent('botPluginReadyEvent', pluginId);
};
