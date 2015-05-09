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
			mathHelper: true,
			birthdays: true,
			birthdaysCommandsOpOnly: true,
			birthdaysRemindOnActivity: false,
			birthdayData: {}
		};
		for (attrname in modified) {settings[attrname]=modified[attrname];}
		return settings;
	}
};

//main plugin object
var pluginObj = {
	//initialize enabled misc features
	miscFeatureInit: function () {
		if (pluginSettings.birthdays) {pluginObj.birthdaysInit();}
	},
	
	//pass messages to enabled features
	mainMiscMsgHandle: function (data) {
		if (pluginSettings.mathHelper) {pluginObj.tryArithmeticEquation(data);}
		if (pluginSettings.birthdays && pluginSettings.birthdaysRemindOnActivity) {pluginObj.birthdaysRemindCheck(data);}
	},
	
	//try if the message is artithmetic equation ending with a "=" char
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
	},
	
	//parse seconds to years, days, hours, minutes, seconds
	parseSeconds: function (s) {
		var seconds = s;
		var secMinute = 1 * 60;
		var secHour = secMinute * 60;
		var secDay = secHour * 24;
		var secYear = secDay * 365;
		
		var years = Math.floor(seconds / secYear);
		seconds = seconds - (years * secYear);
		
		var days = Math.floor(seconds / secDay);
		seconds = seconds - (days * secDay);
		
		var hours = Math.floor(seconds / secHour);
		seconds = seconds - (hours * secHour);
		
		var minutes = Math.floor(seconds / secMinute);
		seconds = seconds - (minutes * secMinute);
		
		return [years, days, hours, minutes, seconds];
	},
	
	parseTimeToSeconds: function (string) {
		var seconds = 0;
		var match;
		var secMinute = 1 * 60;
		var secHour = secMinute * 60;
		var secDay = secHour * 24;
		var secYear = secDay * 365;
		
		if((match = string.match('([0-9]+)y')) !== null) {
			seconds += +match[1]*secYear;
		}
		if((match = string.match('([0-9]+)d')) !== null) {
			seconds += +match[1]*secDay;
		}
		if((match = string.match('([0-9]+)h')) !== null) {
			seconds += +match[1]*secHour;
		}
		if((match = string.match('([0-9]+)m')) !== null) {
			seconds += +match[1]*secMinute;
		}
		if((match = string.match('([0-9]+)s')) !== null) {
			seconds += +match[1];
		}
		
		return seconds;
	},
	
	//birthdays feature init
	birthdaysInit: function () {
		//add commands to commands plugin
		var commandsPlugin = botObj.pluginData.commands.plugin;
		commandsPlugin.commandAdd('bday', function (data) {
			var user = data.messageARGS[1];
			var bdaySec, bday, nextbday, nextbdayString, bdayIsToday = false;
			var date = Math.round(new Date().getTime()/1000);
			if (pluginSettings.birthdayData[user]) {
				bdaySec = +pluginSettings.birthdayData[user];
				bday = new Date(); bday.setTime(bdaySec*1000);
				nextbday = new Date(bday);
				nextbday.setFullYear(new Date().getFullYear());
				if (Math.round(nextbday.getTime()/1000) > date) {
					nextbday = Math.round(nextbday.getTime()/1000);
				} else {
					nextbday.setFullYear(new Date().getFullYear()+1);
					nextbday = Math.round(nextbday.getTime()/1000);
				}
				nextbdayString = pluginObj.parseSeconds(nextbday-date);
				nextbdayString = (nextbdayString[1]+(nextbdayString[0]*365))+'d '+nextbdayString[2]+'h '+nextbdayString[3]+'m '+nextbdayString[4]+'s';
				if ((bday.getMonth() === new Date().getMonth()) && (bday.getDate() == new Date().getDate())) {
					bdayIsToday = true;
				}
				botF.ircSendCommandPRIVMSG('Born on: '+bday.getFullYear()+' '+(bday.getMonth() + 1)+' '+bday.getDate()+', next birthday in: '+nextbdayString+', birthday today: '+(bdayIsToday?'yes':'no')+'.', data.responseTarget);
			}
		}, 'bday "user": get date of known users birthday', pluginId);
		
		commandsPlugin.commandAdd('bdayadd', function (data) {
			if (commandsPlugin.isOp(data.ircData[1]) || !pluginSettings.birthdaysCommandsOpOnly) {
				var user = data.messageARGS[1];
				var date = new Date(data.messageARGS[2]);
				if (botF.isNumeric(date.getTime())) {
					pluginSettings.birthdayData[user] = Math.round(date.getTime()/1000);
				}
			}
		}, 'bdayadd "user" "date": add new birthday', pluginId);
		
		commandsPlugin.commandAdd('bdayremove', function (data) {
			if (commandsPlugin.isOp(data.ircData[1]) || !pluginSettings.birthdaysCommandsOpOnly) {
				var user = data.messageARGS[1];
				if (pluginSettings.birthdayData[user]) {
					delete pluginSettings.birthdayData[user];
				}
			}
		}, 'bdayremove "user": remove a existing birthday', pluginId);
		
		commandsPlugin.commandAdd('bdayuserlist', function (data) {
			var bdayUserList = ""; 
			for (var user in pluginSettings.birthdayData) {
				bdayUserList+="\""+user+"\", ";
			}
			botF.ircSendCommandPRIVMSG("Known users are: "+bdayUserList.replace(/, $/, ".").replace(/^$/, 'No known users.'), data.responseTarget);
		}, 'bdayuserlist: list known birthday users', pluginId);
		
		commandsPlugin.commandAdd('age', function (data) {
			var user = data.messageARGS[1];
			var bdaySec, bday, nextbday, nextbdayString;
			var date = Math.round(new Date().getTime()/1000);
			var age = '';
			if (pluginSettings.birthdayData[user]) {
				bdaySec = +pluginSettings.birthdayData[user];
				age = pluginObj.parseSeconds(date-bdaySec);
				age = age[0]+'y '+age[1]+'d '+age[2]+'h '+age[3]+'m '+age[4]+'s';
				botF.ircSendCommandPRIVMSG('Age of "'+user+'": '+age, data.responseTarget);
			}
			
		}, 'age "user": known users age', pluginId);
	},
	
	birthdaysRemindCheckTrackerObj: {},
	birthdaysRemindCheck: function (data) {
		var bdaySec, bday;
		for (var user in pluginSettings.birthdayData) {
			bdaySec = +pluginSettings.birthdayData[user];
			bday = new Date(); bday.setTime(bdaySec*1000);
			if ((bday.getMonth() === new Date().getMonth()) && (bday.getDate() == new Date().getDate())) {
				if (!pluginObj.birthdaysRemindCheckTrackerObj[user]) {
					pluginObj.birthdaysRemindCheckTrackerObj[user] = {};
				}
				if (!pluginObj.birthdaysRemindCheckTrackerObj[user][data.responseTarget]) {
					botF.ircSendCommandPRIVMSG('Today is "'+user+'" birthday', data.responseTarget);
					pluginObj.birthdaysRemindCheckTrackerObj[user][data.responseTarget] = true;
				}
			} else if (pluginObj.birthdaysRemindCheckTrackerObj[user] &&
				pluginObj.birthdaysRemindCheckTrackerObj[user][data.responseTarget]) {
				delete pluginObj.birthdaysRemindCheckTrackerObj[user][data.responseTarget];
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
	
	//call main feature controlling function
	pluginObj.miscFeatureInit();
	
	//add listeners to simpleMsg plugin
	var simpleMsg = botObj.pluginData.simpleMsg.plugin;
	simpleMsg.msgListenerAdd(pluginId, 'PRIVMSG', function (data) {
		pluginObj.mainMiscMsgHandle(data);
	});
	
	//add commands to commands plugin
	var commandsPlugin = botObj.pluginData.commands.plugin;
	commandsPlugin.commandAdd('parseseconds', function (data) {
		var parsedTime = pluginObj.parseSeconds(data.messageARGS[1]);
		botF.ircSendCommandPRIVMSG(parsedTime[0]+'y '+parsedTime[1]+'d '+parsedTime[2]+'h '+parsedTime[3]+'m '+parsedTime[4]+'s', data.responseTarget);
	}, 'parseseconds: parse seconds to years, days, hours, minutes, seconds', pluginId);
	
	commandsPlugin.commandAdd('parsetime', function (data) {
		var parsedTime = pluginObj.parseTimeToSeconds(data.messageARGS[1]);
		botF.ircSendCommandPRIVMSG(parsedTime, data.responseTarget);
	}, 'parsetime: parse seconds to years, days, hours, minutes, seconds', pluginId);
};
