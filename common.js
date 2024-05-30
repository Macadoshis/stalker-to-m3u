"use strict";
exports.__esModule = true;
exports.fetchData = exports.getConfig = void 0;
var http = require('http');
var fs = require('fs');
function getConfig() {
    var configData = fs.readFileSync('./config.json', { encoding: 'utf8', flag: 'r' });
    var config = JSON.parse(configData);
    return config;
}
exports.getConfig = getConfig;
function fetchData(path) {
    return new Promise(function (resp, err) {
        var config = getConfig();
        http.get({
            hostname: config.hostname,
            port: config.port,
            path: path,
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Authorization': "Bearer " + config.deviceId,
                'Cookie': "mac=" + config.mac + "; stb_lang=en; timezone=Europe/Kiev"
            }
        }, function (res) {
            if (res.statusCode !== 200) {
                console.error("Did not get an OK from the server. Code: " + res.statusCode);
                res.resume();
                err();
            }
            var data = '';
            res.on('data', function (chunk) {
                data += chunk;
            });
            res.on('close', function () {
                console.debug('Retrieved data');
                resp(JSON.parse(data));
            });
        });
    });
}
exports.fetchData = fetchData;
