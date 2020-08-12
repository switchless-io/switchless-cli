var async = require('async');
var controllers = {
	'getting_ready_to_file_gstr3b':function(options,callback){
		async.auto({
			// getFiling
			getFiling:function(callback){
				Filing.findOne({id:options.filing,type:'gstr3b'}).populate('gstin').exec(callback);
			},
			getIncomeInvoices:function(callback){ // invoices included in the filing
				Invoice.find({type:'income',gstr3b:options.filing}).sort('date DESC').exec(callback);
			},
			getExpenseInvoices:function(callback){ // invoices included in the filing
				Invoice.find({type:'expense',gstr3b:options.filing}).populate('gstr2a').sort('date DESC').exec(callback);
			},
			getClients:function(callback){
				// GSTIN.findOne({id:options.filing.gstin}).exec(callback);
				Access.find({gstin:options.gstin,type:'client'}).populate('user').exec(function(err,results){
					if(err)
						return callback(err);
					if(results.length==0)
						return callback(new Error('no clients'));
					callback(err,results);
				});
			},
			getAgents:function(callback){
				Access.find({gstin:options.gstin,type:'albert_agent'}).populate('user').exec(function(err,results){
					if(err)
						return callback(err);
					if(results.length==0)
						return callback('no agents');
					callback(err,results);
				});
			},
			// getClients  - send email to every client
		},function(err,results){
			var clients = _.map(results.getClients, 'user');
			var agents = _.map(results.getAgents, 'user');
			var opts={
				template:'getting_ready_to_file_gstr3b',
				to:_.map(clients, 'email').join(','),
				cc:_.map(agents, 'email').join(','),
				from:'Mr Albert Agent<agent@mralbert.in>',
				subject: 'We are preparing your GSTR3B for '+results.getFiling.gstin.business_name,
				locals:{
					name: _.map(clients, 'name').join(', '),
					filing:results.getFiling,
					income_invoices:results.getIncomeInvoices,
					expense_invoices:results.getExpenseInvoices,
					gstin:results.getFiling.gstin,
					tracker_url:'https://app.mralbert.in/gstin/'+results.getFiling.gstin.value+'/filing/'+results.getFiling.id+'#tracker'
				}
			}
			callback(err,opts);
		});
	},
}
module.exports={
	sendTransactionalEmail:function(options,callback){
		var controllerToGenerateEmailOpts=controllers[options.template];
		// generate the locals here
		async.auto({
			generateEmailOptions:function(callback){
				controllerToGenerateEmailOpts(options,callback);		
			},
			sendEmail:['generateEmailOptions',function(results,callback){
				var email_opts=results.generateEmailOptions;
				if(sails.config.test_points.send_email_to_self.flag){ // test point. Set to true to send mail to self during testing.
					email_opts.to=sails.config.test_points.send_email_to_self.to;
					email_opts.cc=sails.config.test_points.send_email_to_self.cc;
				}
				MailgunService.sendEmail(email_opts,callback);
				// callback(new Error('custom error'));
				
			}],
		},function(err,results){
			callback(err,results);
		})
		// send email here
		// add to activity feed here. 
		// create activity feed can be abstracted to here. 
	},
}