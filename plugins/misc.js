/*jshint node: true*/
/*jshint evil: true*/

"use strict";
//reserved nBot variables
var botObj;
var pluginId;
var botF;
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
var dgram = require('dgram');

//settings constructor
var SettingsConstructor = function (modified) {
	var settings, attrname;
	if (this!==SettingsConstructor) {
		settings = {
			mathHelper: true,
			birthdays: true,
			birthdaysCommandsOpOnly: true,
			birthdaysRemindOnActivity: false,
			birthdayData: {},
			statistics: false
		};
		for (attrname in modified) {settings[attrname]=modified[attrname];}
		return settings;
	}
};

//main plugin object
var pluginObj = {
	//variables
	birthdaysRemindCheckTrackerObj: {},
	channelMessageStatisticsObj: {},
	countdownDataObj: {},
	
	//initialize enabled misc features
	miscFeatureInit: function () {
		if (pluginSettings.birthdays) {pluginObj.birthdaysInit();}
		if (pluginSettings.statistics) {pluginObj.channelMessageStatisticsInit();}
	},
	
	//pass messages to enabled features
	mainMiscMsgHandle: function (data) {
		if (pluginSettings.mathHelper) {pluginObj.tryArithmeticEquation(data);}
		if (pluginSettings.birthdays && pluginSettings.birthdaysRemindOnActivity) {pluginObj.birthdaysRemindCheck(data);}
		if (pluginSettings.statistics) {pluginObj.channelMessageStatisticsTrack(data);}
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
	
	//parse years, days, hours, minutes, seconds to seconds
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
			if (commandsPlugin.isOp(data.nick) || !pluginSettings.birthdaysCommandsOpOnly) {
				var user = data.messageARGS[1];
				var date = new Date(data.messageARGS[2]);
				if (botF.isNumeric(date.getTime())) {
					pluginSettings.birthdayData[user] = Math.round(date.getTime()/1000);
				}
			}
		}, 'bdayadd "user" "date": add new birthday', pluginId);
		
		commandsPlugin.commandAdd('bdayremove', function (data) {
			if (commandsPlugin.isOp(data.nick) || !pluginSettings.birthdaysCommandsOpOnly) {
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
	
	//birthdays remind check
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
	},
	
	//channel message statistics init
	channelMessageStatisticsInit: function () {
		//add commands to commands plugin
		var commandsPlugin = botObj.pluginData.commands.plugin;
		commandsPlugin.commandAdd('msgstat', function (data) {
			var i, sum = 0, message = '', channel = data.to, statsObj = pluginObj.channelMessageStatisticsObj[channel], statsArray = [];
			for (i in statsObj) {
				statsArray.arrayValueAdd([i, statsObj[i]]);
				sum += +statsObj[i];
			}
			statsArray = statsArray.sort(function (a, b) {return a[1] > b[1] ? -1 : 1;});
			for (i in statsArray) {
				message += statsArray[i][0]+'('+Math.floor((statsArray[i][1]/sum)*100)+'%), ';
			}
			if (message) {
				botF.ircSendCommandPRIVMSG(message.replace(/, $/, "."), data.responseTarget);
			}
		}, 'msgstat: prints users percentage of messages in channel', pluginId);
	},
	
	//channel message statistics
	channelMessageStatisticsTrack: function (data) {
		if (!pluginObj.channelMessageStatisticsObj[data.to]) {
			pluginObj.channelMessageStatisticsObj[data.to] = {};
		}
		if (!pluginObj.channelMessageStatisticsObj[data.to][data.nick]) {
			pluginObj.channelMessageStatisticsObj[data.to][data.nick] = 0;
		}
		pluginObj.channelMessageStatisticsObj[data.to][data.nick]++;
	},
	
	//send wake on lan magic packet with a mac addres on local broadcast
	sendWoL: function (macAddr, ipAddr) {
		if (macAddr.match('[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}') !== null) {
			var message = new Buffer('FFFFFFFFFFFF', 'hex'),
				client = dgram.createSocket('udp4'),
				macAddrBuffer = new Buffer(macAddr.split(':').join(''), 'hex'),
				i = 0;
			ipAddr = ipAddr||'255.255.255.255';
			while (i < 16) {
				message = new Buffer.concat([message, macAddrBuffer]);
				i++;
			}
			client.bind(null, function () {
				client.setBroadcast(true);
				client.send(message, 0, message.length, 9, ipAddr, function(err) {
				  client.close();
				});
			});
		}
	},
	
	convertValue: function (from, to, value) {
		var baseValue,
			convertedValue,
			valueType;
		value = +value;
			
		switch (from) {
			case 'bit':
				baseValue = value;
				valueType = 'digital_storage';
				break;
			case 'Kilobit':
				baseValue = value*Math.pow(10, 3);
				valueType = 'digital_storage';
				break;
			case 'Megabit':
				baseValue = value*Math.pow(10, 6);
				valueType = 'digital_storage';
				break;
			case 'Gigabit':
				baseValue = value*Math.pow(10, 9);
				valueType = 'digital_storage';
				break;
			case 'Terabit':
				baseValue = value*Math.pow(10, 12);
				valueType = 'digital_storage';
				break;
			case 'Petabit':
				baseValue = value*Math.pow(10, 15);
				valueType = 'digital_storage';
				break;
			case 'Kilobyte':
				baseValue = value*(Math.pow(10, 3)*8);
				valueType = 'digital_storage';
				break;
			case 'Megabyte':
				baseValue = value*(Math.pow(10, 6)*8);
				valueType = 'digital_storage';
				break;
			case 'Gigabyte':
				baseValue = value*(Math.pow(10, 9)*8);
				valueType = 'digital_storage';
				break;
			case 'Terabyte':
				baseValue = value*(Math.pow(10, 12)*8);
				valueType = 'digital_storage';
				break;
			case 'Petabyte':
				baseValue = value*(Math.pow(10, 15)*8);
				valueType = 'digital_storage';
				break;
			case 'Kibibit':
				baseValue = value*1024;
				valueType = 'digital_storage';
				break;
			case 'Mebibit':
				baseValue = value*Math.pow(1024, 2);
				valueType = 'digital_storage';
				break;
			case 'Gibibit':
				baseValue = value*Math.pow(1024, 3);
				valueType = 'digital_storage';
				break;
			case 'Tebibit':
				baseValue = value*Math.pow(1024, 4);
				valueType = 'digital_storage';
				break;
			case 'Pebibit':
				baseValue = value*Math.pow(1024, 5);
				valueType = 'digital_storage';
				break;
			case 'Kibibyte':
				baseValue = value*(1024*8);
				valueType = 'digital_storage';
				break;
			case 'Mebibyte':
				baseValue = value*(Math.pow(1024, 2)*8);
				valueType = 'digital_storage';
				break;
			case 'Gibibyte':
				baseValue = value*(Math.pow(1024, 3)*8);
				valueType = 'digital_storage';
				break;
			case 'Tebibyte':
				baseValue = value*(Math.pow(1024, 4)*8);
				valueType = 'digital_storage';
				break;
			case 'Pebibyte':
				baseValue = value*(Math.pow(1024, 5)*8);
				valueType = 'digital_storage';
				break;
			case 'Kelvin':
				if (value >= 0) {
					baseValue = value;
					valueType = 'temperature';
				}
				break;
			case 'Celsius':
				if (value >= -273.15) {
					baseValue = value+273.15;
					valueType = 'temperature';
				}
				break;
			case 'Fahrenheit':
				if (value >= -459.67) {
					baseValue = (value+459.67)*(5/9);
					valueType = 'temperature';
				}
				break;
		}
		
		if (valueType == 'digital_storage') {
			switch (to) {
				case 'bit':
					convertedValue = baseValue;
					break;
				case 'Kilobit':
					convertedValue = baseValue/Math.pow(10, 3);
					break;
				case 'Megabit':
					convertedValue = baseValue/Math.pow(10, 6);
					break;
				case 'Gigabit':
					convertedValue = baseValue/Math.pow(10, 9);
					break;
				case 'Terabit':
					convertedValue = baseValue/Math.pow(10, 12);
					break;
				case 'Petabit':
					convertedValue = baseValue/Math.pow(10, 15);
					break;
				case 'Kilobyte':
					convertedValue = baseValue/(Math.pow(10, 3)*8);
					break;
				case 'Megabyte':
					convertedValue = baseValue/(Math.pow(10, 6)*8);
					break;
				case 'Gigabyte':
					convertedValue = baseValue/(Math.pow(10, 9)*8);
					break;
				case 'Terabyte':
					convertedValue = baseValue/(Math.pow(10, 12)*8);
					break;
				case 'Petabyte':
					convertedValue = baseValue/(Math.pow(10, 15)*8);
					break;
				case 'Kibibit':
					convertedValue = baseValue/1024;
					break;
				case 'Mebibit':
					convertedValue = baseValue/Math.pow(1024, 2);
					break;
				case 'Gibibit':
					convertedValue = baseValue/Math.pow(1024, 3);
					break;
				case 'Tebibit':
					convertedValue = baseValue/Math.pow(1024, 4);
					break;
				case 'Pebibit':
					convertedValue = baseValue/Math.pow(1024, 5);
					break;
				case 'Kibibyte':
					convertedValue = baseValue/(1024*8);
					break;
				case 'Mebibyte':
					convertedValue = baseValue/(Math.pow(1024, 2)*8);
					break;
				case 'Gibibyte':
					convertedValue = baseValue/(Math.pow(1024, 3)*8);
					break;
				case 'Tebibyte':
					convertedValue = baseValue/(Math.pow(1024, 4)*8);
					break;
				case 'Pebibyte':
					convertedValue = baseValue/(Math.pow(1024, 5)*8);
					break;
			}
		}
		if (valueType == 'temperature') {
			switch (to) {
			case 'Kelvin':
				convertedValue = baseValue;
				break;
			case 'Celsius':
				convertedValue = baseValue-273.15;
				break;
			case 'Fahrenheit':
				convertedValue = baseValue*(9/5)-459.67;
				break;
			}
		}
		
		return convertedValue;
	},
	
	strTo1337: function (str) {
		var strArray = str.split('');
		var strChar;
		var characterMap = {
			'a': '4',
			'b': '8',
			'e': '3',
			'g': '6',
			'l': '1',
			'o': '0',
			's': '5',
			't': '7'
		};    
		for (var leetChar in characterMap) {
			for (strChar in strArray) {
				if (strArray[strChar] == leetChar) {
					strArray[strChar] = characterMap[leetChar];
				}
			}
		}
		return strArray.join('');
	}
};

//exports
module.exports.plugin = pluginObj;

//reserved functions

//reserved functions: handle "botEvent" from bot (botEvent is used for irc related activity)
module.exports.botEvent = function (event) {
	switch (event.eventName) {
		case 'botPluginDisableEvent':
			(function () {
				for (var countdown in pluginObj.countdownDataObj) {
					clearTimeout(pluginObj.countdownDataObj[countdown][0]);
					delete pluginObj.countdownDataObj[countdown];
				}
			})();
			break;
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
	
	//call main feature controlling function
	pluginObj.miscFeatureInit();
	
	//add listeners to simpleMsg plugin
	var simpleMsg = botObj.pluginData.simpleMsg.plugin;
	simpleMsg.msgListenerAdd(pluginId, 'PRIVMSG', function (data) {
		pluginObj.mainMiscMsgHandle(data);
	});
	
	simpleMsg.msgListenerAdd(pluginId, 'PART', function (data) {
		if (pluginObj.channelMessageStatisticsObj[data.channel] && pluginObj.channelMessageStatisticsObj[data.channel][data.nick]) {
			delete pluginObj.channelMessageStatisticsObj[data.channel][data.nick];
		}
	});
	
	simpleMsg.msgListenerAdd(pluginId, 'QUIT', function (data) {
		for (var i in data.channels) {
			if (pluginObj.channelMessageStatisticsObj[data.channels[i]] && pluginObj.channelMessageStatisticsObj[data.channels[i]][data.nick]) {
				delete pluginObj.channelMessageStatisticsObj[data.channels[i]][data.nick];
			}
		}
	});
	
	simpleMsg.msgListenerAdd(pluginId, 'NICK', function (data) {
		for (var i in data.channels) {
			if (pluginObj.channelMessageStatisticsObj[data.channels[i]] && pluginObj.channelMessageStatisticsObj[data.channels[i]][data.nick]) {
				pluginObj.channelMessageStatisticsObj[data.channels[i]][data.newnick] =  pluginObj.channelMessageStatisticsObj[data.channels[i]][data.nick];
				delete pluginObj.channelMessageStatisticsObj[data.channels[i]][data.nick];
			}
		}
	});
	
	simpleMsg.msgListenerAdd(pluginId, 'KICK', function (data) {
		if (pluginObj.channelMessageStatisticsObj[data.channel] && pluginObj.channelMessageStatisticsObj[data.channel][data.nick]) {
			delete pluginObj.channelMessageStatisticsObj[data.channel][data.nick];
		}
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
	}, 'parsetime: parse "y d h m s" to seconds', pluginId);
	
	commandsPlugin.commandAdd('sendwol', function (data) {
		pluginObj.sendWoL(data.messageARGS[1], data.messageARGS[2]);
	}, 'sendwol "mac" ["ip"]: send wake on lan magic packet', pluginId);
	
	commandsPlugin.commandAdd('convert', function (data) {
		var convertedValue;
		botF.ircSendCommandPRIVMSG((convertedValue = pluginObj.convertValue(data.messageARGS[1], data.messageARGS[2], data.messageARGS[3])) !== undefined ? convertedValue:'Unable to convert.', data.responseTarget);
	}, 'convert "from" "to" "value": convert value to another', pluginId);
	
	commandsPlugin.commandAdd('1337', function (data) {
		botF.ircSendCommandPRIVMSG(pluginObj.strTo1337(data.messageARGS[1]), data.responseTarget);
	}, '1337 "text": convert text to 1337 text', pluginId);
	
	commandsPlugin.commandAdd('countdown', function (data) {
		var timeoutId;
		var response = "";
		var i;
		var parsedTime;
		var date = Math.round(new Date().getTime()/1000);
		switch (data.messageARGS[1].toUpperCase()) {
			case 'SET':
				timeoutId = setTimeout(function () {
					botF.ircSendCommandPRIVMSG('Countdown "'+data.messageARGS[2]+'" finished.', data.responseTarget);
					delete pluginObj.countdownDataObj[data.messageARGS[2]];
				}, data.messageARGS[3]*1000);
				pluginObj.countdownDataObj[data.messageARGS[2]] = [timeoutId, date+(+data.messageARGS[3])];
				break;
			case 'REMOVE':
				clearTimeout(pluginObj.countdownDataObj[data.messageARGS[2]][0]);
				delete pluginObj.countdownDataObj[data.messageARGS[2]];
				break;
			case 'LIST':
				for (i in pluginObj.countdownDataObj) {
					response += '"'+i+'", ';
				}
				botF.ircSendCommandPRIVMSG('Current countdowns: '+response.replace(/, $/, ".").replace(/^$/, 'No running countdowns.'), data.responseTarget);
				break;
			case 'SHOW':
				parsedTime = pluginObj.parseSeconds(pluginObj.countdownDataObj[data.messageARGS[2]][1]-date);
				console.log(pluginObj.countdownDataObj[data.messageARGS[2]][1]+' '+date);
				botF.ircSendCommandPRIVMSG('Time left: '+parsedTime[0]+'y '+parsedTime[1]+'d '+parsedTime[2]+'h '+parsedTime[3]+'m '+parsedTime[4]+'s', data.responseTarget);
				break;
		}
	}, 'countdown SET|REMOVE|LIST|SHOW ["name"] ["seconds"]: set, list or show countdowns', pluginId);
	
	commandsPlugin.commandAdd('reverse', function (data) {
		var txt = data.messageARGS[1], txtr = ''; 
		var i = txt.length; while (i >= 0) {txtr += txt.charAt(i); i--;}
		botF.ircSendCommandPRIVMSG(txtr, data.responseTarget)
	}, 'reverse "text": reverse text', pluginId);
};
