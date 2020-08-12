console.log(process.env['RANDOM_ID']);
const fs = require('fs');
var  data = (fs.readFileSync('./.vscode/launch.json')).toString();

// Striper core intelligent RegExp.
// The idea is to match data in quotes and
// group JS-type comments, which is not in
// quotes. Then return nothing if there is
// a group, else return matched data.\

// data = '{"alex":"name"}';
// const json = JSON.parse(data.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => g ? "" : m));

// console.log(data);
// console.log(json);

// var launch = require('.vscode/launch.json');
// var launch = require('./.vscode/launch.json');
// console.log(launch);


var Hjson = require('hjson');

var launch = Hjson.parse(data);

// console.log(launch);
var local_test_env;
launch.configurations.forEach(function(c){
	if(c.name=='local_test')
		local_test_env=c.env;
})
// console.log(local_test_env);
Object.keys(local_test_env).forEach(function(key){
	// console.log(key);
	process.env[key] = local_test_env[key];
})
// process.env['RANDOM_ID'] = Math.random();
console.log(process.env['DB_USER']);
// console.log(text2);

// const requireJSON = require('json-easy-strip');
// const obj = requireJSON('./.vscode/launch.json');
// console.log(obj);