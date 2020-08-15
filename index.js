#!/usr/bin/env node

var cpx = require('cpx');
var inquirer = require('inquirer');
var async = require('async');
var path = require('path');
var fs = require('fs');
var installer = require('./installer');
var initializer = require('./initializer');
var _ = require('lodash');

const updateNotifier = require('update-notifier');
const pkg = require('./package.json');
 
updateNotifier({pkg}).notify();

var initialize = function (callback) {
	inquirer.prompt([
		{
			type: 'list',
			name: 'initialize_what',
			message: 'which flavor of switchless would you like to start with?',
			choices: [
				'api-backend',
				'web-app',
			],
		},
	]).then(answers => {
		switch (answers.initialize_what) {
			case 'api-backend':
				initializer.initialiseAPIBackend(callback);
				break;
			case 'web-app':
				console.log('yo');
				initializer.initialiseWebApp(callback);
				break;
		}
		// callback(null);
	});
}

var installSpecific = function (callback) {
	inquirer.prompt([
		{
			type: 'list',
			name: 'install_what',
			message: 'What would you like to install?',
			choices: [
				'bull',
				'user-login',
				'kue',
				'semantic',
				'navbar',
				'gitignore',
				'logging',
				'ratelimit-policy',
				'sendgrid',
				'mkdocs',
				'trix',
				'sentry',
				'group-based-access',
				'paytmPayments'
			]
		},
	]).then(answers => {
		switch (answers.install_what) {
			case 'bull':
				installer.installBull(callback);
				break;
			case 'user-login':
				installer.installUserLogin(callback);
				break;
			case 'kue':
				installer.installKue(callback);
				break;
			case 'semantic':
				installer.installSemanticUI(callback);
				break;
			case 'logging':
				installer.installLogging(callback);
				break;
			case 'ratelimit-policy':
				installer.installRateLimit(callback);
				break;
			case 'sendgrid':
				installer.installSendgrid(callback);
				break;
			case 'trix':
				installer.installTrix(callback);
				break;
			case 'sentry':
				installer.installSentry(callback);
				break;
			case 'group-based-access':
				installer.installGroupAccess(callback);
				break;
			case 'paytmPayments':
				installer.installPaytmPayments(callback);
				break;
			case 'navbar':
				installer.installNavbar(callback);
				break;
			case 'gitignore':
				installer.installGitignore(callback);
				break;
			case 'mkdocs':
				installer.installMkdocs(callback);
				break;
		}
		// callback(null);
	});
}

var checkInstallation = function (callback) {
	callback(null);
}


var main = function (callback) {

	inquirer.prompt([
		{
			type: 'list',
			name: 'first_action',
			message: 'What would you like to do?',
			choices: ['initialize', 'install', 'check_installation']
		},
	]).then(answers => {
		// this should show up

		// console.log(answers);
		// console.log(answers.first_action);
		switch (answers.first_action) {
			case 'initialize':
				// console.log('going to do initialize');
				initialize(callback);
				break;
			case 'install':
				// console.log('going to do install');
				installSpecific(callback);
				break;
			// case 'check_installation':
			// 	// console.log('going to do check_installation');
			// 	initialize(callback);
			// 	break;

		}

	});
	// callback(null);
}

main(function (err, results) {
	console.log('we are all done');
})


// console.log(installer);









