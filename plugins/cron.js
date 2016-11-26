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

"use strict";
//reserved nBot variables
var bot;
var pId;
var options;
var pOpts;

//variables
var pluginDisabled = false;

//settings constructor
var SettingsConstructor = function (modified) {
	var settings, attrname;
	if (this!==SettingsConstructor) {
		settings = {
			botUpdateInterval: 10000
		};
		for (attrname in modified) {settings[attrname]=modified[attrname];}
		return settings;
	}
};

//main plugin object
var plugin = {};

plugin.botIrcConnectionRegisteredHandle = function() {
	var botUpdateInterval;
	bot.ircBotUpdateSelf();
	botUpdateInterval = setInterval(function () {
		if (!pluginDisabled) {
			bot.ircBotUpdateSelf();
		} else {
			clearInterval(botUpdateInterval);
		}
	}, pOpts.botUpdateInterval||10000);
	bot.ircConnection.once('close', function() {
		clearInterval(botUpdateInterval);
	});
};

//exports
module.exports.plugin = plugin;
module.exports.ready = false;

//reserved functions

//reserved functions: handle "botEvent" from bot (botEvent is used for irc related activity)
module.exports.botEvent = function (event) {
	//event is a object with properties "eventName" and "eventData"
	switch (event.eventName) {
		case 'botPluginDisableEvent':
			if (event.eventData == pId) {pluginDisabled = true;}
			break;
		case 'botIrcConnectionRegistered':
			plugin.botIrcConnectionRegisteredHandle();
			break;
	}
};

//reserved functions: main function called when plugin is loaded
module.exports.main = function (i, b) {
	//update variables
	bot = b;
	pId = i;
	options = bot.options;
	pOpts = options.pluginsSettings[pId];

	//if plugin settings are not defined, define them
	if (pOpts === undefined) {
		pOpts = new SettingsConstructor();
		options.pluginsSettings[pId] = pOpts;
		bot.im.settingsSave();
	}

	//if loaded after connection has already registered
	//make sure the handle runs
	if (bot.ircConnectionRegistered) {
		plugin.botIrcConnectionRegisteredHandle();
	}

	//plugin is ready
	exports.ready = true;
	bot.emitBotEvent('botPluginReadyEvent', pId);
};
