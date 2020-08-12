/**
 * Route Mappings
 * (sails.config.routes)
 *
 * Your routes tell Sails what to do each time it receives a request.
 *
 * For more information on configuring custom routes, check out:
 * https://sailsjs.com/anatomy/config/routes-js
 */

module.exports.routes = {

	/***************************************************************************
	*                                                                          *
	* Make the view located at `views/homepage.ejs` your home page.            *
	*                                                                          *
	* (Alternatively, remove this and add an `index.html` file in your         *
	* `assets` directory)                                                      *
	*                                                                          *
	***************************************************************************/

	'GET /':'MainController.landingPage',
	'GET /login': 'AuthController.login',
	'POST /login': 'AuthController.login',
	'GET /signup': 'AuthController.signup',
	'POST /signup': 'AuthController.signup',
	'GET /logout': 'AuthController.logout',
	'GET /forgot': 'AuthController.view_forgot',
	'POST /forgot': 'AuthController.forgot',
	'GET /reset': 'AuthController.view_reset',
	'POST /reset': 'AuthController.reset',
	'GET /forgot': 'AuthController.view_forgot',
	'POST /forgot': 'AuthController.forgot',
	'GET /reset': 'AuthController.view_reset',
	'POST /reset': 'AuthController.reset',


	//webhooks
	'POST /webhook/razorpay' : 'WebhookController.razorpay',
	'POST /webhook/mailgun-inbound-parser':'WebhookController.mailgunInboundParser',
	


	// Bull related tasks
	'GET /bull':'BullController.index',
	'GET /bull/:state':'BullController.listItems',
	'POST /bull/retry':'BullController.retryJob',
	'POST /bull/delete':'BullController.deleteJob',
	'POST /bull/repeat/delete':'BullController.deleteRepeatJob',
	'POST /bull/add':'BullController.addJob',


	// Admin functionalities 
	'GET /admin':'AdminController.adminLanding',

	/***************************************************************************
	*                                                                          *
	* More custom routes here...                                               *
	* (See https://sailsjs.com/config/routes for examples.)                    *
	*                                                                          *
	* If a request to a URL doesn't match any of the routes in this file, it   *
	* is matched against "shadow routes" (e.g. blueprint routes).  If it does  *
	* not match any of those, it is matched against static assets.             *
	*                                                                          *
	***************************************************************************/

};
