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
//variables
var util_proto = require(__dirname+'/util_proto');

//define and export util
var util = module.exports = {};

//get shell like arguments from a string
util.getArgsFromString = function (str) {
	var strArray = str.split('');
	var strARGS = [];
	var strARGC = 0;
	var strChar = '';
	var isString = false;
	var escape = false;
	var escaped = false;
	
	function addToArgs(str) {
		if (!strARGS[strARGC]) {
			strARGS[strARGC] = '';
		}
		strARGS[strARGC] += str;
	}
	
	for (strChar in strArray) {
		if (escaped) {escaped = false;}
		if (escape) {escape = false; escaped = true;}
		switch (strArray[strChar]) {
			case '\\':
				if (!escaped) {
					escape = true;
				} else {
					addToArgs('\\');
				}
				break;
			case '"':
				if (!escaped) {
					if (!isString) {
						isString = true;
					} else {
						isString = false;
					}
				} else {
					addToArgs('"');
				}
				break;
			case ' ':
				if (!isString) {
					strARGC++;
				} else if (isString) {
					if (escaped) {addToArgs('\\');}
					addToArgs(' ');
				}
				break;
			default:
				if (escaped) {addToArgs('\\');}
				addToArgs(strArray[strChar]);
		}
	}
	return [strARGS, strARGC];
};

//copy properties from source(s) to target(t)
util.objCopy = function (t, s) {
	for (var p in s) {
		t[p] = s[p];
	}
	return t;
};

//check if n is only numbers
util.isNumeric = function (n) {
	return !isNaN(parseFloat(n)) && isFinite(n);
};

//compare From arrF Against arrA
util.arrDiff = function (arrF, arrA) {
	if (arrF instanceof Array &&
		arrA instanceof Array) {
		return arrF.filter(function(i) {
			return arrA.indexOf(i) < 0;
		});
	}
};

//append value to array
util.arrAdd = function (a, v) {
	a.splice(a.lastIndexOf(a.slice(-1)[0])+1, 0, v);
	return a;
};

//remove one matched value from array
util.arrRm = function (a, v) {
	if (a.lastIndexOf(v) !== -1) {
		return a.splice(a.lastIndexOf(v), 1);
	}
};

//convert eatch char to a ascii hex representation of it
util.strToHex = function (str) {
	return new Buffer(str.toString(), 'utf8').toString('hex');
};

//parse ascii hex representation of chars and convert them back
util.strFromHex = function (str) {
	return new Buffer(str.toString(), 'hex').toString('utf8');
};

//interpret chars in string as utf and convert to ascii hex form
util.strToUtf8Hex = function (str) {
	var hex, i;
	
	var result = "";
	for (i=0; i<str.length; i++) {
		hex = str.charCodeAt(i).toString(16);
		result += ("000"+hex).slice(-4);
	}
	
	return result;
};

//parse string for ascii representation of utf8 hex codes and convert em
util.strFromUtf8Hex = function (str) {
	var j;
	var hexes = str.match(/.{1,4}/g) || [];
	var back = "";
	for(j = 0; j<hexes.length; j++) {
		back += String.fromCharCode(parseInt(hexes[j], 16));
	}
	
	return back;
};

//https://gist.github.com/Mottie/7018157
util.expandIPv6Address = function (address) {
	var fullAddress = "";
	var expandedAddress = "";
	var validGroupCount = 8;
	var validGroupSize = 4;
	var i;
	
	var ipv4 = "";
	var extractIpv4 = /([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})/;
	var validateIpv4 = /((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})/;
	
	// look for embedded ipv4
	if(validateIpv4.test(address)) {
		groups = address.match(extractIpv4);
		for(i=1; i<groups.length; i++)
		{
			ipv4 += ("00" + (parseInt(groups[i], 10).toString(16)) ).slice(-2) + ( i==2 ? ":" : "" );
		}
		address = address.replace(extractIpv4, ipv4);
	}
	
	if(address.indexOf("::") == -1) // All eight groups are present.
		fullAddress = address;
	else { // Consecutive groups of zeroes have been collapsed with "::".
		var sides = address.split("::");
		var groupsPresent = 0;
		for (i=0; i<sides.length; i++) {
			groupsPresent += sides[i].split(":").length;
		}
		fullAddress += sides[0] + ":";
		for (i=0; i<validGroupCount-groupsPresent; i++) {
			fullAddress += "0000:";
		}
		fullAddress += sides[1];
	}
	var groups = fullAddress.split(":");
	for (i=0; i<validGroupCount; i++) {
		while (groups[i].length < validGroupSize) {
			groups[i] = "0" + groups[i];
		}
		expandedAddress += (i!=validGroupCount-1) ? groups[i] + ":" : groups[i];
	}
	return expandedAddress;
};


util.randomString = function (len, charSet) {
	charSet = charSet || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	var randomString = '';
	for (var i = 0; i < len; i++) {
		var randomPoz = Math.floor(Math.random() * charSet.length);
		randomString += charSet.substring(randomPoz,randomPoz+1);
	}
	return randomString;
};
