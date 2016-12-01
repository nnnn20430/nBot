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

Object.defineProperty(Array.prototype, "diff", {
	value: function(a) {
		return this.filter(function(i) {return a.indexOf(i) < 0;});
	},
	configurable: true,
	writable: true,
	enumerable: false
});

Object.defineProperty(Array.prototype, "add", {
	value: function(a) {
		this.splice(this.lastIndexOf(this.slice(-1)[0])+1, 0, a);
		return this;
	},
	configurable: true,
	writable: true,
	enumerable: false
});

Object.defineProperty(Array.prototype, "remove", {
	value: function(a) {
		if (this.lastIndexOf(a) !== -1) {
			return this.splice(this.lastIndexOf(a), 1);
		}
	},
	configurable: true,
	writable: true,
	enumerable: false
});

Object.defineProperty(String.prototype, "toHex", {
	value: function(a) {
		return new Buffer(this.toString(), 'utf8').toString('hex');
	},
	configurable: true,
	writable: true,
	enumerable: false
});

Object.defineProperty(String.prototype, "fromHex", {
	value: function(a) {
		return new Buffer(this.toString(), 'hex').toString('utf8');
	},
	configurable: true,
	writable: true,
	enumerable: false
});

Object.defineProperty(String.prototype, "toUtf8Hex", {
	value: function(a) {
		var hex, i;

		var result = "";
		for (i=0; i<this.length; i++) {
			hex = this.charCodeAt(i).toString(16);
			result += ("000"+hex).slice(-4);
		}

		return result;
	},
	configurable: true,
	writable: true,
	enumerable: false
});

Object.defineProperty(String.prototype, "fromUtf8Hex", {
	value: function(a) {
		var j;
		var hexes = this.match(/.{1,4}/g) || [];
		var back = "";
		for(j = 0; j<hexes.length; j++) {
			back += String.fromCharCode(parseInt(hexes[j], 16));
		}

		return back;
	},
	configurable: true,
	writable: true,
	enumerable: false
});
