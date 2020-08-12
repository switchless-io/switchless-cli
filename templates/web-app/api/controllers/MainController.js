/**
 * UserController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */
var async = require('async');
const moment = require('moment-timezone');

const fs = require('fs');
const AWS = require('aws-sdk');

var Bull = require( 'bull' );
var queue = new Bull('queue',{redis:sails.config.bull.redis});


const zohoInvoice_config = {
	client: {
		id:  process.env.ZOHO_CLIENT_ID,
		secret: process.env.ZOHO_CLIENT_SECRET
	},
	auth: {
		tokenHost: `${process.env.ZOHO_TOKEN_HOST_URL}`,
		// tokenPath: '/oauth/v2/auth?access_type=offline&prompt=consent',
		// authorizePath: '/oauth/v2/token',
		tokenPath: '/oauth/v2/token',
		authorizePath: '/oauth/v2/auth',
	}
};
 
// const { ClientCredentials, ResourceOwnerPassword, AuthorizationCode } = require('simple-oauth2');
// const client = new AuthorizationCode(zohoInvoice_config);


var viewGstr3bFiling=function(filing,req,res){
	var locals={};
	async.auto({
		getInvoices:function(callback){ // invoices already claimed
			Invoice.find({gstr3b:req.params.filing_id}).sort('date DESC').populate('gstr2a').exec(callback);
		},
		getDocuments:function(callback){
			var filter={
				gstin:req.gstin.id,
				createdAt:{'>':filing.createdAt.toISOString()}
			};
			Document.find(filter).sort('createdAt DESC').exec(callback);
		},
		getTasks:function(callback){
			Task.find({filing:req.params.filing_id,gstin:req.gstin.id}).sort('createdAt DESC').populate('assignees').populate('gstin').exec(callback);
		},
		getUnfiledExpenseInvoices:function(callback){ // invoices should be in gstr2a and not claimed
			var start_date= new Date(filing.for_date); // show invoices up to a year old
			start_date.setMonth(start_date.getMonth()-12);
			var end_date = new Date(filing.for_date);
			end_date.setMonth(end_date.getMonth()+1);
			var filter={
				and:[
					{gstin:req.gstin.id},
					{gstr3b:null},
					{type:'expense'},
					{gstr2a:{'!':null}},
					// {date:{'>=':'2019-10-01'}},
					{date:{'>=':start_date.toISOString()}},
					{date:{'<=':end_date.toISOString()}}
					// {date:{'<':'2019-11-01'}}
				]
			}
			Invoice.find(filter).populate('gstr2a').sort('date DESC').exec(callback);
		},
		getUnfiledIncomeInvoices:function(callback){ // invoices should be in gstr2a and not claimed
			var start_date= new Date(filing.for_date);
			start_date.setMonth(start_date.getMonth()-12);
			var end_date = new Date(filing.for_date);
			end_date.setMonth(end_date.getMonth()+1);
			var filter={
				and:[
					{gstin:req.gstin.id},
					{gstr3b:null},
					{type:'income'},
					{date:{'>=':start_date.toISOString()}},
					{date:{'<=':end_date.toISOString()}}
				]
			}
			Invoice.find(filter).populate('gstr2a').sort('date DESC').exec(callback);
		}
	},function(err,results){
		if(err)
			throw err;
		locals.filing=filing;
		locals.filing.invoices=results.getInvoices;
		locals.unfiled_invoices=results.getUnfiledIncomeInvoices.concat(results.getUnfiledExpenseInvoices);
		locals.documents=results.getDocuments;
		locals.tasks=results.getTasks;
		var metrics={
			revenue:0,
			expense:0,
			net_tax_payable:0,
			tax_collected:{
				cgst:0,
				sgst:0,
				igst:0,
				total:0,
			},
			tax_paid:{
				cgst:0,
				sgst:0,
				igst:0,
				total:0,
			},
		}

		// concat invoices 
		var invoices = locals.filing.invoices.concat(locals.unfiled_invoices);
		// calculate all metrics 
		invoices.forEach(function(invoice){
			if(locals.filing.stage=='upload_invoice'){
				// tentative metrics
				if(invoice.type=='income'){
					metrics.revenue+=invoice.amount_no_tax;
					metrics.tax_collected.cgst+=invoice.cgst;
					metrics.tax_collected.sgst+=invoice.sgst;
					metrics.tax_collected.igst+=invoice.igst;
				}else if(invoice.type=='expense'){
					metrics.expense+=invoice.amount_no_tax;
					metrics.tax_paid.cgst+=invoice.cgst;
					metrics.tax_paid.sgst+=invoice.sgst;
					metrics.tax_paid.igst+=invoice.igst;
				}
			}else{
				// actual metrics
				if(invoice.type=='income' && invoice.gstr3b==filing.id){
					metrics.revenue+=invoice.amount_no_tax;
					metrics.tax_collected.cgst+=invoice.cgst;
					metrics.tax_collected.sgst+=invoice.sgst;
					metrics.tax_collected.igst+=invoice.igst;
				}else if(invoice.type=='expense' && invoice.gstr3b==filing.id){
					metrics.expense+=invoice.amount_no_tax;
					metrics.tax_paid.cgst+=invoice.cgst;
					metrics.tax_paid.sgst+=invoice.sgst;
					metrics.tax_paid.igst+=invoice.igst;
				}
			}
		});
		metrics.tax_collected.total=metrics.tax_collected.cgst+metrics.tax_collected.sgst+metrics.tax_collected.igst;
		metrics.tax_paid.total=metrics.tax_paid.cgst+metrics.tax_paid.sgst+metrics.tax_paid.igst;
		metrics.net_tax_payable=metrics.tax_collected.total - metrics.tax_paid.total;

		locals.metrics=metrics;
		console.log('\n\n\n\n\n\n\n---------------');
		console.log(filing.isfiled);
		console.log(filing.test);
		console.log('---------------');
		// only if the stage is complete, on viewing the page, add the metrics to the cache in details
		// if(filing.stage=='complete'){
			var details = filing.details;
			if(!details.cache)
				details.cache={};
			details.cache.metrics=metrics;
			Filing.updateOne({id:filing.id},{details:details}).exec(function(err,result){
				if(err)
					throw err;
				res.view('view_gstr3b_filing',locals);    
			})
		// }else{
			// res.view('view_gstr3b_filing',locals);
		// }
		// locals.filing.invoices= results.getInvoices;
	})
};


var viewGstr1Filing=function(filing,req,res){
	var locals={};
	async.auto({
		getInvoices:function(callback){
			var filter={
				type:'income',
				gstr1:req.params.filing_id,
				gstin:req.gstin.id
			}
			Invoice.find(filter).sort('date DESC').populate('gstr1').populate('gstr3b').exec(callback);
		},
		getDocuments:function(callback){
			Document.find({gstin:req.gstin.id}).exec(callback);
		},
		getUnfiledInvoices:function(callback){
			var start_date= new Date(filing.for_date);
			var end_date = new Date(filing.for_date);
			end_date.setMonth(end_date.getMonth()+3); // hardcoded for quarterly filing
			var filter={
				and:[
					{gstin:req.gstin.id},
					{'type':'income'},
					{gstr1:null},
					{date:{'<':end_date.toISOString()}}
				]
			}
			Invoice.find(filter).populate('gstr3b').sort('date DESC').exec(callback);
		}
	},function(err,results){
		if(err)
			throw err;
		locals.filing=filing;
		locals.filing.invoices=results.getInvoices;
		locals.unfiled_invoices=results.getUnfiledInvoices;
		locals.documents=results.getDocuments;
		locals.tasks=results.getTasks;
		var metrics={
			expense:0,
			tax_paid:{
				cgst:0,
				sgst:0,
				igst:0,
				total:0,
			},
		}

		// concat invoices 
		var invoices = locals.filing.invoices.concat(locals.unfiled_invoices);
		// calculate all metrics 
		locals.filing.invoices.forEach(function(invoice){
			if(invoice.type=='income'){ // double check
				metrics.expense+=invoice.amount_no_tax;
				metrics.tax_paid.cgst+=invoice.cgst;
				metrics.tax_paid.sgst+=invoice.sgst;
				metrics.tax_paid.igst+=invoice.igst;
			}
			
		});
		metrics.tax_paid.total=metrics.tax_paid.cgst+metrics.tax_paid.sgst+metrics.tax_paid.igst;

		locals.metrics=metrics;
		// locals.filing.invoices= results.getInvoices;
		res.view('view_gstr1_filing',locals);
	})
};
var viewGstr2aFiling=function(filing,req,res){
	var locals={};
	async.auto({
		getInvoices:function(callback){
			Invoice.find({gstr2a:req.params.filing_id}).sort('date DESC').populate('gstr2a').populate('gstr3b').exec(callback);
		},
		getDocuments:function(callback){
			Document.find({gstin:req.gstin.id}).exec(callback);
		},
		getUnfiledInvoices:function(callback){
			var start_date= new Date(filing.for_date);
			var end_date = new Date(filing.for_date);
			end_date.setMonth(end_date.getMonth()+1);
			var filter={
				and:[
					{gstin:req.gstin.id},
					// {date:{'>=':start_date.toISOString()}},
					{gstr2a:null},
					// {date:{'>=':'2019-10-01'}},
					{date:{'<':end_date.toISOString()}}
					// {date:{'<':'2019-11-01'}}
				]
			}
			Invoice.find(filter).populate('gstr2a').populate('gstr3b').sort('date DESC').exec(callback);
		}
	},function(err,results){
		if(err)
			throw err;
		locals.filing=filing;
		locals.filing.invoices=results.getInvoices;
		locals.unfiled_invoices=results.getUnfiledInvoices;
		locals.documents=results.getDocuments;
		locals.tasks=results.getTasks;
		var metrics={
			expense:0,
			tax_paid:{
				cgst:0,
				sgst:0,
				igst:0,
				total:0,
			},
		}

		// concat invoices 
		var invoices = locals.filing.invoices.concat(locals.unfiled_invoices);
		// calculate all metrics 
		locals.filing.invoices.forEach(function(invoice){
			if(invoice.type=='expense'){ // double check
				metrics.expense+=invoice.amount_no_tax;
				metrics.tax_paid.cgst+=invoice.cgst;
				metrics.tax_paid.sgst+=invoice.sgst;
				metrics.tax_paid.igst+=invoice.igst;
			}
			
		});
		metrics.tax_paid.total=metrics.tax_paid.cgst+metrics.tax_paid.sgst+metrics.tax_paid.igst;

		locals.metrics=metrics;
		// locals.filing.invoices= results.getInvoices;
		res.view('view_gstr2a_filing',locals);
	})
};
var viewGstr9Filing=function(filing,req,res){

};

module.exports = {
	landingPage:function(req,res){
		res.redirect('/select_gstin');
	},
	selectGSTIN:function(req,res){
		async.auto({
			getAllAccess:function(callback){
				Access.find({user:req.user.id}).populate('gstin').exec(callback);
			},
		},function(err,results){
			var locals={
				accesses:results.getAllAccess,
			}
			res.view('select_gstin',locals);
		});
	},
	createGSTIN:function(req,res){
		var locals={
			gstin:{},
		};
		if(req.body){
			console.log(req.body);
			// create gstin
			// add this user as the client
			async.auto({
				createGST:function(callback){
					GSTIN.create(req.body).fetch().exec(callback);
				},
				createAccessForUser:['createGST',function(results,callback){
					var access={
						type:'client',
						user:req.user.id,
						gstin:results.createGST.id,
					}
					Access.create(access).exec(callback);
				}]
			},function(err,results){
				if (err)
					throw err;
				res.redirect('/select_gstin');
			})
		}else{
			res.view('create_gstin',locals);
		}
		
	},
	viewGSTIN:function(req,res){
		console.log('came here ');
		var locals={};
		// var fy='2019-2020';
		var fy = GeneralService.getFinancialYear(new Date());
		if(req.query.fy)
			fy=req.query.fy;
		async.auto({
			getGSTIN:function(callback){
				GSTIN.findOne({value:req.params.gst_no}).exec(callback);//TODO - user filter should also be added
			},
			getAllFilings:['getGSTIN',function(results,callback){
				console.log('one to three');
				console.log(results);
				// get this financial year. 
				
				
				
				var filter={
					and:[
						{gstin:results.getGSTIN.id},
						// {date:{'>=':start_date.toISOString()}},
						// {filing:null},
						// {date:{'>=':'2019-10-01'}},
						{
							for_date:{
								'>=':fy.split('-')[0]+'-04-01',
								'<':fy.split('-')[1]+'-04-01',
							}
						}
						// {date:{'<':'2019-11-01'}}
					]
				}
				Filing.find(filter).sort('for_date ASC').exec(callback);
			}]
		},function(err,results){
			if(err)
				throw err;
			locals.gstin=results.getGSTIN;
			locals.filings=results.getAllFilings;
			locals.filing_status={
				gstr2a:{},
				gstr3b:{},
				gstr1:{},
				gstr9:{},
			}
			locals.filing_status.gstr3b["Apr "+fy.split('-')[0]]={}; 
			locals.filing_status.gstr3b["May "+fy.split('-')[0]]={};
			locals.filing_status.gstr3b["Jun "+fy.split('-')[0]]={};
			locals.filing_status.gstr3b["Jul "+fy.split('-')[0]]={};
			locals.filing_status.gstr3b["Aug "+fy.split('-')[0]]={};
			locals.filing_status.gstr3b["Sep "+fy.split('-')[0]]={};
			locals.filing_status.gstr3b["Oct "+fy.split('-')[0]]={};
			locals.filing_status.gstr3b["Nov "+fy.split('-')[0]]={};
			locals.filing_status.gstr3b["Dec "+fy.split('-')[0]]={};
			locals.filing_status.gstr3b["Jan "+fy.split('-')[1]]={};
			locals.filing_status.gstr3b["Feb "+fy.split('-')[1]]={};
			locals.filing_status.gstr3b["Mar "+fy.split('-')[1]]={};

			locals.filing_status.gstr2a["Apr "+fy.split('-')[0]]={}; 
			locals.filing_status.gstr2a["May "+fy.split('-')[0]]={};
			locals.filing_status.gstr2a["Jun "+fy.split('-')[0]]={};
			locals.filing_status.gstr2a["Jul "+fy.split('-')[0]]={};
			locals.filing_status.gstr2a["Aug "+fy.split('-')[0]]={};
			locals.filing_status.gstr2a["Sep "+fy.split('-')[0]]={};
			locals.filing_status.gstr2a["Oct "+fy.split('-')[0]]={};
			locals.filing_status.gstr2a["Nov "+fy.split('-')[0]]={};
			locals.filing_status.gstr2a["Dec "+fy.split('-')[0]]={};
			locals.filing_status.gstr2a["Jan "+fy.split('-')[1]]={};
			locals.filing_status.gstr2a["Feb "+fy.split('-')[1]]={};
			locals.filing_status.gstr2a["Mar "+fy.split('-')[1]]={};

			// get the gstr1 filings 
			// if the first one is 
			// var gstr1_frequency = _.get(results.getGSTIN.details,'config.gstr1_frequency["'+fy+'""]');
			var gstr1_frequency = _.get(results.getGSTIN.details,'config.gstr1_frequency["'+fy+'"]','quarterly');
			if(gstr1_frequency=='quarterly'){
				locals.filing_status.gstr1["Apr-Jun "+fy.split('-')[0]]={};
				locals.filing_status.gstr1["Jul-Sep "+fy.split('-')[0]]={};
				locals.filing_status.gstr1["Oct-Dec "+fy.split('-')[0]]={};
				locals.filing_status.gstr1["Jan-Mar "+fy.split('-')[1]]={};
			}else{
				locals.filing_status.gstr1["Apr "+fy.split('-')[0]]={}; 
				locals.filing_status.gstr1["May "+fy.split('-')[0]]={};
				locals.filing_status.gstr1["Jun "+fy.split('-')[0]]={};
				locals.filing_status.gstr1["Jul "+fy.split('-')[0]]={};
				locals.filing_status.gstr1["Aug "+fy.split('-')[0]]={};
				locals.filing_status.gstr1["Sep "+fy.split('-')[0]]={};
				locals.filing_status.gstr1["Oct "+fy.split('-')[0]]={};
				locals.filing_status.gstr1["Nov "+fy.split('-')[0]]={};
				locals.filing_status.gstr1["Dec "+fy.split('-')[0]]={};
				locals.filing_status.gstr1["Jan "+fy.split('-')[1]]={};
				locals.filing_status.gstr1["Feb "+fy.split('-')[1]]={};
				locals.filing_status.gstr1["Mar "+fy.split('-')[1]]={};
			}

			// locals.filings.forEach(function(filing){
			//     if(filing.type=='gstr3b'){
			//         locals.filing_status.gstr3b[filing.for]=filing.stage;
			//     }else if(filing.type=='gstr2a'){
			//         locals.filing_status.gstr2a[filing.for]='done';
			//     }else if(filing.type=='gstr1'){
			//         locals.filing_status.gstr1[filing.for]=filing.stage;
			//     }else if(filing.type=='gstr9'){
			//         locals.filing_status.gstr9=filing.stage;
			//     }
			// })

			locals.filings.forEach(function(filing){
				if(filing.type=='gstr3b'){
					locals.filing_status.gstr3b[filing.for]=filing;
				}else if(filing.type=='gstr2a'){
					locals.filing_status.gstr2a[filing.for]=filing;
				}else if(filing.type=='gstr1'){
					locals.filing_status.gstr1[filing.for]=filing;
				}else if(filing.type=='gstr9'){
					locals.filing_status.gstr9=filing;
				}
			})
			locals.fy=fy;
			locals.next_fy=(parseInt(fy.split('-')[0])+1)+'-'+(parseInt(fy.split('-')[1])+1);
			locals.prev_fy=(parseInt(fy.split('-')[0])-1)+'-'+(parseInt(fy.split('-')[1])-1);
			console.log('came here');
			res.view('view_gstin',locals);
		})
	},
	createGstr3bFiling:function(req,res){
		var locals={
			month:'Jan',
			year:'2020',
			error:null,
		};
		if(req.body){
			async.auto({
				checkIfFilingAlreadyExists:function(callback){
					var filter={
						for : req.body.month + ' ' + req.body.year,
						gstin:req.gstin.id,
						type:'gstr3b',
					}
					Filing.find(filter).exec(function(err,filings){
						if(err)
							callback(err);
						if(filings.length)
							callback('filing_already_exists');
						else
							callback();
					})

				},
				createFiling:['checkIfFilingAlreadyExists',function(results,callback){
					var filing={
						for : req.body.month + ' ' + req.body.year,
						type:'gstr3b',
						status:'in_progress',
						stage:'upload_invoice',
						for_date: new Date(req.body.month + ' ' + req.body.year+ ' GMT+0000'),
						gstin:req.gstin.id,
					}
					Filing.create(filing).fetch().exec(callback);
				}],
				getClients:function(cb){
					var filter={
						type:'client',
						gstin:req.gstin.id
					}
					Access.find(filter).exec(cb);
				},
				createTask:['createFiling','getClients',function(results,cb){
					// var doc=results.createDocument;
					var filing=results.createFiling;
					var due_date = new Date();
					var agents=[];
					due_date.setDate(due_date.getDate()+1);
					var task={
						title:'Upload all income and expense invoices ',
						description:`Lets do filing for ${filing.for}. Please upload all invoices.`,
						type:'gstr3b__upload_invoice',
						gstin:req.gstin.id,
						filing:filing.id,
						status:'open',
						due_date:new Date(due_date),
						is_mandatory:true,
						assignees: _.map(results.getClients, 'user'),
						link:`/gstin/${req.gstin.value}/filing/${filing.id}`,
					}
					Task.create(task).exec(cb);
				}]
				// 
			},function(err,results){
				if(err){
					if(err=='filing_already_exists'){
						locals.error='This filing already exists';
						locals.month=req.body.month;
						locals.year=req.body.year;
						res.view('create_gstr3b_filing',locals);
					}
					else 
						throw err;
				}
				res.redirect('/gstin/'+req.gstin.value+'/filings');
			})
		}else{
			res.view('create_gstr3b_filing',locals);
		}
	},
	createGstr2aFiling:function(req,res){
		var locals={
			month:'Jan',
			year:'2020',
			error:null,
		};
		if(req.body){
			async.auto({
				checkIfFilingAlreadyExists:function(callback){
					var filter={
						for : req.body.month + ' ' + req.body.year,
						gstin:req.gstin.id,
						type:'gstr2a',
					}
					Filing.find(filter).exec(function(err,filings){
						if(err)
							callback(err);
						if(filings.length)
							callback('filing_already_exists');
						else
							callback();
					})

				},
				createFiling:['checkIfFilingAlreadyExists',function(results,callback){
					var filing={
						for : req.body.month + ' ' + req.body.year,
						type:'gstr2a',
						status:'in_progress',
						stage:'',
						for_date: new Date(req.body.month + ' ' + req.body.year+ ' GMT+0000'),
						gstin:req.gstin.id,
					}
					Filing.create(filing).fetch().exec(callback);
				}],
			},function(err,results){
				if(err){
					if(err=='filing_already_exists'){
						locals.error='This filing already exists';
						locals.month=req.body.month;
						locals.year=req.body.year;
						res.view('create_gstr2a_filing',locals);
					}
					else 
						throw err;
				}
				res.redirect('/gstin/'+req.gstin.value+'/filings/?sort=DESC&type=gstr2a');
			})
		}else{
			res.view('create_gstr2a_filing',locals);
		}
	},
	createGstr1Filing:function(req,res){

		var locals={
			frequency:'quarterly',
			month:'',
			year:new Date().toDateString().split(' ')[3],
			error:null,
		};
		var temp = new Date().toDateString().split(' ')[1];
		switch(temp){
			case 'Jan':
			case 'Feb':
			case 'Mar':
				locals.month='Jan-Mar';
				break;
			case 'Apr':
			case 'May':
			case 'Jun':
				locals.month='Apr-Jun';
				break;
			case 'Jul':
			case 'Aug':
			case 'Sep':
				locals.month='Jul-Sep';
				break;
			case 'Oct':
			case 'Nov':
			case 'Dec':
				locals.month='Oct-Dec';
				break;
		}
		if(req.body){
			async.auto({
				checkIfFilingAlreadyExists:function(callback){
					var filter={
						for : req.body.month + ' ' + req.body.year,
						gstin:req.gstin.id,
						type:'gstr1',
					}
					Filing.find(filter).exec(function(err,filings){
						if(err)
							callback(err);
						if(filings.length)
							callback('filing_already_exists');
						else
							callback();
					})

				},
				createFiling:['checkIfFilingAlreadyExists',function(results,callback){
					var filing={
						for : req.body.month + ' ' + req.body.year,
						type:'gstr1',
						status:'in_progress',
						stage:'upload_invoice',
						for_date: new Date(req.body.month.split('-')[0] + ' ' + req.body.year+ ' GMT+0000'),
						frequency:req.body.frequency,
						gstin:req.gstin.id,
					}
					Filing.create(filing).fetch().exec(callback);
				}],
				getClients:function(cb){
					var filter={
						type:'client',
						gstin:req.gstin.id
					}
					Access.find(filter).exec(cb);
				},
				// createTask:['createFiling','getClients',function(results,cb){
				// 	// var doc=results.createDocument;
				// 	var filing=results.createFiling;
				// 	var due_date = new Date();
				// 	var agents=[];
				// 	due_date.setDate(due_date.getDate()+1);
				// 	var task={
				// 		title:'Upload all income and expense invoices ',
				// 		description:`Lets do filing for ${filing.for}. Please upload all invoices.`,
				// 		type:'gstr1__upload_invoice',
				// 		gstin:req.gstin.id,
				// 		filing:filing.id,
				// 		status:'open',
				// 		due_date:new Date(due_date),
				// 		is_mandatory:true,
				// 		assignees: _.map(results.getClients, 'user'),
				// 		link:`/gstin/${req.gstin.value}/filing/${filing.id}`,
				// 	}
				// 	Task.create(task).exec(cb);
				// }]
				// 
			},function(err,results){
				if(err){
					if(err=='filing_already_exists'){
						locals.error='This filing already exists';
						locals.frequency=req.body.frequency;
						locals.month=req.body.month;
						locals.year=req.body.year;
						res.view('create_gstr1_filing',locals);
					}
					else 
						throw err;
				}
				res.redirect('/gstin/'+req.gstin.value+'/filings/?sort=DESC&type=gstr1');
			})
		}else{
			res.view('create_gstr1_filing',locals);
		}
	},
	viewFiling:function(req,res){
		Filing.findOne({id:req.params.filing_id,gstin:req.gstin.id}).exec(function(err,filing){
			if(filing.type=='gstr1')
				viewGstr1Filing(filing,req,res);
			else if(filing.type=='gstr2a')
				viewGstr2aFiling(filing,req,res);
			else if(filing.type=='gstr3b')
				viewGstr3bFiling(filing,req,res);
			else if(filing.type=='gstr9')
				viewGstr9Filing(filing,req,res);
		});
	},
	
	test:function(req,res){
		console.log(test);
		res.send('test');
	},
	listFilings:function(req,res){
		var locals={};
		var sort='DESC';
		var type='gstr3b';
		if(req.query.type)
			type=req.query.type;
		if(req.query.sort)
			sort=req.query.sort;
		async.auto({
			getAllFilings:function(callback){
				var filter={
					gstin:req.gstin.id,
					type:type,
				}
				Filing.find(filter).sort('for_date '+sort).exec(callback);
			},

		},function(err,results){
			if(err)
				throw err;
			locals.filings=results.getAllFilings;
			console.log('came here');
			res.view('list_filings',locals);
		})
	},
	listActivities:function(req,res){
		Activity.find({gstin:req.gstin.id})
			.sort('createdAt DESC')
			.limit(1000)
			.populate('user')
			.exec(function(err,activities){
			var locals={
				activities:activities,
				moment:moment
			}
			res.view('list_activities',locals);
		});
	},
	listInvoices:function(req,res){
		var locals={};
		var filters = {
			gstin:req.gstin.id,
			type:'expense'
		}
		if(req.query.type && req.query.type=='income')
			filters.type='income';


		Invoice.find(filters)
		.populate('gstr3b')
		.populate('gstr1')
		.populate('gstr2a')
		.populate('gstr9')
		.populate('documents')
		.sort('date DESC').exec(function(err,invoices){
			if(err)
				throw err;
			locals.invoices=invoices;
			res.view('list_invoices',locals);
		})
	},
	viewInvoice:function(req,res){
		
		async.auto({
			getInvoice:function(callback){
				Invoice.findOne({id:req.params.i_id,gstin:req.gstin.id})
					.populate('gstr2a')
					.populate('gstr3b')
					.populate('gstr1')
					.populate('gstr9')
					.populate('documents')
					.exec(callback);
			}
		},function(err,results){
			if(err)
				throw err;
			if(!results.getInvoice)
				return res.send('This invoice does not exist. Could have been deleted or you dont have access to this');
			var locals={
				invoice:results.getInvoice
			};
			res.view('view_invoice',locals);
		})
	},
	createInvoice:function(req,res){
		Filing.find({ gstin:req.gstin.id }).exec(function (err, filings) {
			if (req.body) { // post request
				// console.log(req.body);
				// const fx = require('money');
				// fx.base = 'INR';
				// fx.rates = sails.config.fx_rates;
				var referer = req.body.referer;
				var invoice = req.body;
				invoice.date=new Date(req.body.date+ ' GMT+0000');
				invoice.created_by= 'user';
				invoice.type = req.body.type;
				invoice.remote_id = req.body.remote_id.trim();
				// invoice.filing=1;
				invoice.gstin=req.gstin.id;
				// invoice.buyer_gst_no=req.body.buyer_gst; // temp
				if(invoice.type=='income')
					invoice.seller_gst_no=req.gstin.value;
				else if(invoice.type=='expense')
					invoice.buyer_gst_no=req.gstin.value;

				invoice.buyer_gst_no=invoice.buyer_gst_no.trim();
				invoice.seller_gst_no=invoice.seller_gst_no.trim();
				// console.log('before transaction find or create');
				// console.log('\n\n\n\n--------');
				// console.log(invoice);
				async.auto({
					createInvoice:function(callback){
						Invoice.create(invoice).fetch().exec(callback);
						// if the docuemnt is present, it will auto update document table using waterline associations.
						// link documents as an extra step is not necessary.
					},
					createActivity:['createInvoice',function(results,callback){
						var invoice = _.cloneDeep(results.createInvoice);
						var activity={
							log: {
								invoice:invoice,
							},
							user: req.user.id,
							type: 'invoice_create',
							gstin: req.gstin.id,
							doer_type:'client'
						};
						
						Activity.create(activity).exec(callback);
					}],
					// linkDocument:['createInvoice',function(results,callback){
					//     if(req.body.document){
					//         Document.updateOne({id:req.body.document,gstin:req.gstin.id},{invoice:results.createInvoice.id}).exec(callback);
					//     }else{
					//         callback(null);
					//     }
					// }],
					// mark the task associated with the document as done.
					// markTaskAsDone:function(callback)
				},function (err, invoice) {
						if (err)
							throw err;
						else {
							if(referer)
								res.redirect(referer);
							else
									res.redirect('/gstin/' + req.gstin.value +'/invoices');
						}
					});
			} else { // view the form
				var locals = {
					invoice: {
						date: '',
					},
					filings:filings,
				};
				console.log('\n\n\n -------');
				console.log(req.query.type);
				if(req.query.type=="income")
					res.view('create_income_invoice', locals);
				else 
					res.view('create_expense_invoice', locals);

			}
			
		})
		
		
	},
	editInvoice:function(req,res){
		Filing.find({ gstin:req.gstin.id }).exec(function (err, filings) {
			if (req.body) { // post request
				// console.log(req.body);
				// const fx = require('money');
				// fx.base = 'INR';
				// fx.rates = sails.config.fx_rates;
				var referer = req.body.referer;
				var invoice = req.body;
				invoice.date=new Date(req.body.date + ' GMT+0000');
				invoice.created_by= 'user';
				// invoice.filing=1;
				invoice.gstin=req.gstin.id;
				invoice.remote_id = req.body.remote_id.trim();
				// invoice.buyer_gst_no=req.body.buyer_gst; // temp
				if(invoice.type=='income')
					invoice.seller_gst_no=req.gstin.value;
				else if(invoice.type=='expense')
					invoice.buyer_gst_no=req.gstin.value;


				invoice.buyer_gst_no=invoice.buyer_gst_no.trim();
				invoice.seller_gst_no=invoice.seller_gst_no.trim();
				// console.log('before transaction find or create');
				// console.log('\n\n\n\n--------');
				// console.log(invoice);

				async.auto({
					
					editInvoice:function(callback){
						Invoice.updateOne({id:req.params.i_id},invoice).exec(callback);
					},
					createActivity:['editInvoice',function(results,callback){
						var invoice = _.cloneDeep(results.editInvoice);
						var activity={
							log: {
								invoice:invoice,
							},
							user: req.user.id,
							type: 'invoice_edit',
							gstin: req.gstin.id,
							doer_type:'client'
						};
						Activity.create(activity).exec(callback);
					}],
				},function (err, inv) {
					if (err)
						throw err;
					else {
						if(referer)
							res.redirect(referer);
						else
							res.redirect('/gstin/' + req.gstin.value +'/invoices');
					}
				});
			} else { // view the form
				Invoice.findOne({id:req.params.i_id}).exec(function(err,invoice){
					
					if(err)
						throw err;
					if(!invoice)
						return res.send('This invoice does not exist');
					var locals = {
						invoice: invoice,
						filings: filings,
					};
					if(invoice.type=="income")
						res.view('create_income_invoice', locals);
					else 
						res.view('create_expense_invoice', locals);
				})
				
			}

		})
	},
	// deleteInvoice:function(req,res){
	//     var locals = {};
	//     res.view('delete_invoice', locals);
	// },
	markAs:function(req,res){
		var update={
			status:'',
		}
		if(req.params.mark_as=='add_to_gstr3b'){
			update.gstr3b=req.body.gstr3b;
			update.status='claimed';
		}else if(req.params.mark_as=='remove_from_gstr3b'){
			update.gstr3b=null;
			update.status='';
		}else if(req.params.mark_as=='present_in_this_gstr2a'){
			update.gstr2a=req.body.gstr2a;
		}else if(req.params.mark_as=='not_present_in_this_gstr2a'){
			update.gstr2a=null;
		}else if(req.params.mark_as=='add_to_gstr1'){
			update.gstr1=req.body.gstr1;
		}else if(req.params.mark_as=='remove_from_gstr1'){
			update.gstr1=null;
		}
		async.auto({
					
			updateInvoice:function(callback){
				Invoice.updateOne({id:req.params.i_id},update).exec(callback);
			},
			createActivity:['updateInvoice',function(results,callback){
				var invoice = _.cloneDeep(results.updateInvoice);
				var activity={
					log: {
						invoice:invoice,
						req_body:req.body,
						req_params_mark_as:req.params.mark_as,
					},
					user: req.user.id,
					type: 'invoice_marked_as',
					gstin: req.gstin.id,
					doer_type:'albert_agent'
				};
				Activity.create(activity).exec(callback);
			}],
		},function (err, inv) {
			if (err)
				throw err;
			res.send('ok');
		});
	},
	completeStep:function(req,res){
		async.auto({
			getFiling:function(callback){
				var filter = {
					id:req.params.filing_id,
					gstin:req.gstin.id
				};
				Filing.findOne(filter).exec(callback);
			},
			updateFiling:['getFiling',function(results,callback){
				
				var filter = {
					id:req.params.filing_id,
					gstin:req.gstin.id,
				};
				var new_stage=GeneralService.nextStage(results.getFiling.type,results.getFiling.stage);
				// var new_stage=getNewStage(results.getFiling.stage);
				var to_update={
					stage:new_stage,
				}
				if(new_stage=='complete'){
					to_update.status='filed';
					to_update.filed_by='mralbert';
				}
				Filing.update(filter,to_update).exec(callback);
			}],
			completeTask:['getFiling',function(results,callback){
				var filter={
					gstin:req.gstin.id,
					filing:req.params.filing_id,
					status:'open',
					type:'gstr3b__'+results.getFiling.stage,
				}
				var task_updates={
					completed_by:req.user.id,
					done_date:new Date(),
					status:'done',
				}
				Task.update(filter,task_updates).exec(callback)
			}],
			getAssigneesIds:['getFiling',function(results,callback){
				var new_stage=GeneralService.nextStage(results.getFiling.type,results.getFiling.stage);
				// prepare_gst - agents
				// audit - auditors 
				// pay_gst - client
				// file_gst - agents
				// complete - no one
				var assignees_ids=[];
				var filter ={
					gstin:req.gstin.id,
				}
				if(new_stage=='prepare_gst'||new_stage=='file_gst'){
					// get agents here
					filter.type='albert_agent';
				}else if(new_stage=='audit'){
					// get auditors here
					filter.type='auditor';
				}else if(new_stage=='pay_gst'){
					// get clients here
					filter.type='client';
				}
				if(new_stage!='complete'){
					Access.find(filter).exec(function(err,accesses){
						callback(null,_.map(accesses, 'user'));
					});
				}else{
					callback(null,assignees_ids);
				}
			}],
			createTask:['getFiling','getAssigneesIds',function(results,callback){
				var new_stage=GeneralService.nextStage(results.getFiling.type,results.getFiling.stage);
				var filing = results.getFiling;
				var task={
					type:'gstr3b__'+new_stage,
					gstin:req.gstin.id,
					filing:req.params.filing_id,
					status:'open',
					// due_date:new Date(due_date),
					is_mandatory:true,
					assignees: results.getAssigneesIds,
					link:`/gstin/${req.gstin.value}/filing/${filing.id}`,
				}
				switch(new_stage){
					case 'prepare_gst':
						task.title=`Prepare GST filing for client - ${req.gstin.business_name}`;
						task.description=`Client has finished upload invoice stage. Prepare GST filing for client - ${req.gstin.business_name} for month of ${results.getFiling.for}`;
						// task.due_date=GeneralService.dueIn('1_day');
						break;
					case 'audit':
						task.title=`Audit GST filing for client - ${req.gstin.business_name}`;
						task.description=`Albert Agent has finished preparing the GST. Please audit the gst - ${req.gstin.business_name} for month of ${results.getFiling.for}`;
						// task.due_date=GeneralService.dueIn('1_day');
						break;
					case 'pay_gst':
						task.title=`Pay GST - ${req.gstin.business_name}`;
						task.description=`Your GST ${req.gstin.business_name} for month of ${results.getFiling.for}, has been prepared and audited. Chellan is created. Please make the payment on the GST portal`;
						// task.due_date=GeneralService.dueIn('2_days');
						break;
					case 'file_gst':
						task.title=`File GST - ${req.gstin.business_name}`;
						task.description=`Your GST is pending filing now. Please file GST`;
						// task.due_date=GeneralService.dueIn('1_day');
						break;
				}
			   
				if(results.getFiling.type=='gstr3b' && new_stage!='complete')
					Task.create(task).exec(callback);
				else
					callback(null);
			}],
			sendEmail:['getFiling',function(results,callback){
				var promise=null;
				var new_stage=GeneralService.nextStage(results.getFiling.type,results.getFiling.stage);
				if(results.getFiling.type=='gstr3b'){
					switch(new_stage){
						case 'audit': // ask the clients to make payments
							var data={
								title:'Send Email - We are preparing your GSTR3B',
								options:{
									template:'getting_ready_to_file_gstr3b',
									gstin:req.gstin.id,
									filing:req.params.filing_id,
								},
								info:{}
							};
							promise = queue.add('send_transactional_email',data);
							break;
						case 'pay_gst': // ask the clients to make payments
							var data={
								title:'Filing prepared email to client',
								options:{
									template:'gstr3b_needs_to_be_paid',
									gstin:req.gstin.id,
									filing:req.params.filing_id,
								},
								info:{}
							};
							promise = queue.add('send_transactional_email',data);
							break;
						case 'complete': // ask the clients to make payments
							var data={
								title:'Send Email - Your GSTR3B filing is complete',
								options:{
									template:'filed_gstr3b',
									gstin:req.gstin.id,
									filing:req.params.filing_id,
								},
								info:{}
							};
							promise = queue.add('send_transactional_email',data);
							break;
					}
				}else if(results.getFiling.type=='gstr1'){
					switch(new_stage){
						case 'audit': // ask the clients to make payments
							var data={
								title:'Send Email - We are preparing your GSTR1',
								options:{
									template:'getting_ready_to_file_gstr1',
									gstin:req.gstin.id,
									filing:req.params.filing_id,
								},
								info:{}
							};
							promise = queue.add('send_transactional_email',data);
							break;
						case 'complete': // ask the clients to make payments
							var data={
								title:'Send Email - Your GSTR1 filing is complete',
								options:{
									template:'filed_gstr1',
									gstin:req.gstin.id,
									filing:req.params.filing_id,
								},
								info:{}
							};
							promise = queue.add('send_transactional_email',data);
							break;
					}
				}
				if(promise)
					GeneralService.p2c(promise,callback);
				else
					callback(null);
			}]

			// createActivityLog:['updateFiling',function(results,callback){
			//     var new_stage=getNewStage(results.getFiling.stage);
			// }]
		},function(err,results){
			if (err){
				if(err=='not valid stage')
					res.send('not valid stage');
				else
					throw err;
			}
			else 
				res.send('ok');
		});
	},
	userSettings:function(req,res){
		var locals={}
		res.view('coming_soon',locals);
	},
	settings:function(req,res){
		res.redirect('/gstin/'+req.gstin.value+'/settings/account');
	},
	accountSettings:function(req,res){
		var locals={};
		if(req.body){
			var select='value,state,business_name,billing_address';
			if(req.user.access_flags.is_admin)
				select += ',plan,payment_frequency,mrr';
			var updated_gstin=GeneralService.filterObject(req.body,select);
			updated_gstin.details=req.gstin.details;
			if(!updated_gstin.details.config)
				updated_gstin.details.config={};
			updated_gstin.details.config.portal_username=req.body.portal_username;
			updated_gstin.details.config.portal_password=req.body.portal_password;
			updated_gstin.details.config.dob=req.body.dob;
			
			async.auto({
				editGST:function(callback){
					GSTIN.updateOne({id:req.gstin.id},updated_gstin).exec(callback);
				},
			},function(err,results){
				if (err)
					throw err;
				// if(req.body.referer)
				// 	res.redirect(req.body.referer);
				// else 
				res.redirect(`/gstin/${results.editGST.value}/settings/account`);
			})
		}else{
			res.view('settings/edit_account',locals);
		}




	},
	accessSettings:function(req,res){
		var locals={};
		async.auto({
			getAllAccess:function(callback){
				Access.find({gstin:req.gstin.id}).sort('createdAt DESC').populate('user').exec(callback);
			},
			updateCache:['getAllAccess',function(results,callback){
				var details = req.gstin.details;
				if(!details.cache)
					details.cache={};
				var agent = null;
				results.getAllAccess.forEach(function(access){
					if(access.type=='albert_agent')
						agent=access.user;
				})
				details.cache.agent=agent;
				GSTIN.updateOne({id:req.gstin.id},{details:details}).exec(callback);
			}],
		},function(err,results){
			if(err)
				throw err;
			locals.accesses=results.getAllAccess;
			res.view('settings/edit_access',locals);
		});
	},
	subscriptionSettings:function(req,res){
		var locals={};
		async.auto({
			getSubscription:function(callback){
				Subscription.find({gstin:req.gstin.id, status: ['active', 'created']}).populate('plan').exec(callback);
			},
			getPayments: ['getSubscription', function(results, cb){
				if(results.getSubscription.length)
					Payment.find({subscription: results.getSubscription[0].id}).exec(cb);
				else
					cb(null);
			}],
			getEstimates: ['getPayments', function(results, cb){
				if(results.getSubscription.length){
					var payment_ids = _.map(results.getPayments, 'id');
					Estimate.find({payment: payment_ids, status: 'paid'}).sort('createdAt DESC').exec(cb);
				} else{
					cb(null, [])
				}
			}]
		},function(err,results){
			if(err)
				throw err;
			locals.subscription=results.getSubscription;
			locals.bills = results.getEstimates;
			locals.moment = require('moment-timezone');
			res.view('settings/edit_subscription',locals);
		});
	},
	emailForwardingSettings:function(req,res){
		var locals={};
		res.view('settings/edit_email_forwarding',locals);
	},
	gstr1FrequencySettings:function(req,res){
		var locals={};
		if(req.body){
			async.auto({
				editGST:function(callback){
					var details = req.gstin.details;
					if(!details.config)
						details.config={};
					details.config.gstr1_frequency={};
					if(typeof req.body.fy =='object')
						for(var i=0;i<req.body.fy.length;i++){
							if(req.body.fy[i])
								details.config.gstr1_frequency[req.body.fy[i]]=req.body.frequency[i]
						}	
						
					else{
						if(req.body.fy)
							details.config.gstr1_frequency[req.body.fy]=req.body.frequency;
					}
					GSTIN.updateOne({id:req.gstin.id},{details:details}).exec(callback);
				},
			},function(err,results){
				if (err)
					throw err;
				// if(req.body.referer)
				// 	res.redirect(req.body.referer);
				// else 
				res.redirect(`/gstin/${results.editGST.value}/settings/gstr1_frequency`);
			})
		}else{
			res.view('settings/gstr1_frequency',locals);
		}
	},
	integrationSettings:function(req,res){
		var locals={};
		async.auto({
			getZohoStatus:function(callback){
				GSTIN.findOne({id:req.gstin.id}).exec(function(err,result){
					callback(err,result);
				});
			},
		},function(err,results){
			var integrate = false;
			var zohoID_present = false;
			// var zoho = JSON.parse(results.getZohoStatus.details.zoho_tokens);
			if(err)
				throw err;
			if(results.getZohoStatus.details == null){
				integrate = false;
				zohoID_present = false
			}
			else if(results.getZohoStatus.details.zoho_tokens == null){
				integrate = false;
				zohoID_present = false;
			}
			else if(results.getZohoStatus.details.zoho_tokens && results.getZohoStatus.details.zohoId){
				integrate = true;
				zohoID_present = true;
			}
			else if(results.getZohoStatus.details.zohoId == null){
				integrate = true;
				zohoID_present = false;
			}
			else
				integrate = true;
			locals.zoho_details = results.getZohoStatus.details;
			locals.integrate = integrate;
			locals.zohoID_present = zohoID_present;
			res.view('settings/edit_integration',locals);
		});
	},
	createAccess:function(req,res){
		var access={
			type:req.body.type,
			user:req.body.user_id,
			gstin:req.gstin.id,
		}
		Access.create(access).exec(function(err,results){
			res.redirect('/gstin/'+req.gstin.value+'/settings/access');
		})
	},
	revokeAccess:function(req,res){
		Access.destroyOne({id:req.params.acc_id,gstin:req.gstin.id}).exec(function(err,result){
			if(err)
				throw err;
			
			res.send({success:'success'})
		});
	},
	dropdownListUsers:function(req,res){
		User.find({email:{contains:req.query.email}}).limit(10).exec(function(err,users){
			var data ={
				success:true,
				results:[]
			}
			users.forEach(function(user){
				var result={
					name:user.name,
					value:user.id,
					text:user.name
				}
				data.results.push(result);
			})
			res.send(data);
		});
	},
	// this is a frontend api
	editComments:function(req,res){
		async.auto({
			getInvoice:function(callback){
				Invoice.findOne({id:req.body.invoice}).exec(callback);
			},
			updateInvoice:['getInvoice',function(results,callback){
				var invoice = results.getInvoice;
				if(invoice.gstin==req.gstin.id){
					Invoice.updateOne({id:req.body.invoice},{comments:req.body.comments}).exec(callback);
				}else{
					callback('you cant edit that invoice');
				}
			}],
			createActivity:['updateInvoice',function(results,callback){
				var invoice = _.cloneDeep(results.updateInvoice);
				var activity={
					log: {
						invoice:invoice,
					},
					user: req.user.id,
					type: 'invoice_comments_update',
					gstin: req.gstin.id,
					doer_type:'user'
				};
				
				Activity.create(activity).exec(callback);
			}],
		},function(err,results){
			if(err=='you cant edit that invoice')
				res.send(400,'you cant edit that invoice');

			if(err && err!='you cant edit that invoice')
				throw err;
			else
				res.send('ok');
		})
	},
	apiSendEmail:function(req,res){
		var data={
			title:'Filing prepared email to client',
			options:{
				gstin:req.body.gstin,
				filing:req.body.filing,
			},
			info:{}
		};
		
		async.auto({
			sendEmail:function(callback){
				var promise = queue.add('send_email__'+req.body.template,data);
				GeneralService.p2c(promise,callback);
				// var opts={
				//     template:'test',
				//     to:'alexjv89@gmail.com',
				//     from:'Mr Albert Agent<agent@mralbert.in>',
				//     subject: 'Test mail',
				//     locals:{
				//         name: 'Gandhi',
				//     }
				// }
				// MailgunService.sendEmail(opts,callback);
			}
		},function(err,results){
			if(err=='you cant edit that invoice')
				res.send(400,'you cant edit that invoice');

			if(err && err!='you cant edit that invoice')
				throw err;
			else
				res.send('ok');
		})
	},
	// all the tasks for user. 
	// user context, not gstin context 
	listTasks:function(req,res){
		var locals={};
		
		async.auto({
			identifyTasks:function(callback){
				User.findOne({id:req.user.id}).populate('tasks',{}).exec(function(err,user){
					callback(err,user.tasks);
				});
			},
			getTasks:['identifyTasks',function(results,callback){
				var task_ids=_.map(results.identifyTasks, 'id');
				Task.find({id:task_ids}).sort('createdAt DESC').populate('assignees').populate('gstin').exec(callback);
			}]
		},function(err,results){
			if(err)
				throw err;
			locals.tasks=results.getTasks;
			res.view('list_tasks',locals);
		})
		// Task.find({assignees:[req.user.id]}).exec(function(err,results){
		// 	locals.tasks=results;
		// });
	},
	taskMarkAs:function(req,res){
		var update = {
			status:req.body.status,
			completed_by:req.user.id,
			done_date:new Date(),
		}
		Task.updateOne({id:req.params.t_id},update).exec(function(err,results){
			if(err)
				return err;
			res.send('task updated');
		})
	},
	listTasksInGST:function(req,res){
		async.auto({
			getTasks:function(callback){
				Task.find({gstin:req.gstin.id}).sort('createdAt DESC').populate('assignees').populate('gstin').exec(callback);
			}
		},function(err,results){
			if(err)
				throw err;
			var locals={
				tasks:results.getTasks,
			}
			res.view('list_tasks_in_gst',locals);
		})
	},
	createTask:function(req,res){
		var locals={
			month:'Jan',
			year:'2020',
			error:null,
		};
		if(req.body){
			var task=req.body;
			task.assignees=[1,2];
			task.creator=req.user.id;
			task.status='open';
			task.link='https://www.google.com';
			if(!task.due_date)
				delete task.due_date;
			async.auto({
				createTask:function(callback){
					Task.create(task).exec(callback);
				},
				// 
			},function(err,results){
				if(err)
					throw err;
				res.redirect('/task/create');
				// res.redirect('/gstin/'+req.gstin.value+'/filings/');
			})
		}else{
			async.auto({
				getAllAccess:function(callback){
					Access.find({user:req.user.id}).populate('gstin').exec(callback);
				},	            
			},function(err,results){
				if (err)
					throw err;
				locals.task={};
				locals.accesses=results.getAllAccess;
				res.view('create_task',locals);
			})
		}
	},
	uploadDocuments:function(req,res){
		async.auto({
			uploadFiles: function (cb) {
				req.file('files').upload(function (err, uploadedFiles) {
					if (err) return cb(err);
					cb(null, uploadedFiles)
				});
			},
			processFiles:['uploadFiles',function(results,cb){
				async.eachOf(results.uploadFiles,function(u_file,index,next){
					async.auto({  
						getFileType: async function(cb){
							const FileType = require('file-type');
							var file_type= await FileType.fromFile(u_file.fd);
							// cb(null,file_type);
							return file_type
						},
						uploadOriginalFileToS3:['getFileType',function(results,cb){
							var s3 = new AWS.S3({
								accessKeyId: sails.config.aws.key,
								secretAccessKey: sails.config.aws.secret,
								region: sails.config.aws.region
							});
							
							var params = {Bucket: sails.config.aws.bucket, 
								Key: _.get(u_file, 'stream.fd'), 
								Body: fs.createReadStream(u_file.fd),
								ContentType:results.getFileType.mime,
								// ContentType:u_file.type,
							};
							s3.upload(params, function(err, data) {
								cb(err, data);
							});
						}],
						createDocument:['getFileType','uploadOriginalFileToS3',function(results,cb){
							var s3doc=results.uploadOriginalFileToS3;
							var doc={
								filename:u_file.filename,
								filetype:results.getFileType.mime,
								type:'invoice',
								size:u_file.size,
								location:s3doc.Location,
								gstin:req.gstin.id
							}
							Document.create(doc).fetch().exec(cb);
						}],
						getAgents:function(cb){
							var filter={
								type:'albert_agent',
								gstin:req.gstin.id
							}
							Access.find(filter).exec(cb);
						},
						createTask:['createDocument','getAgents',function(results,cb){
							var doc=results.createDocument;
							var due_date = new Date();
							var agents=[];
							due_date.setDate(due_date.getDate()+1);
							var task={
								title:'Convert document to invoice',
								description:`${req.user.name} uploaded a document. If the document is an invoice, then create the invoice.`,
								type:'process_document',
								gstin:req.gstin.id,
								filing:req.params.filing_id?req.params.filing_id:null,
								status:'open',
								due_date:new Date(due_date),
								is_mandatory:true,
								assignees: _.map(results.getAgents, 'user'),
								link:`/gstin/${req.gstin.value}/document/${doc.id}`,
							}
							Task.create(task).exec(cb);
						}]
					}, function(error, results){
						next(error);
					})
				},function(err){
					cb(err)
				});
			}]
		},function(err,results){
			if(err)
				throw err;
			console.log('upload invoices');
			res.redirect(req.headers.referer);
		})
	},
	listPlans: function(req, res){
		res.view('list_plan')
	},
	createSubscription: function(req, res){
		if(!req.body.plan) return res.status(400).json({'error': 'plan is required to create a subscription'})

		async.auto({
			getPlan: function(cb){
				Plan.findOne({id: req.body.plan}).exec(cb);
			},
			getGSTIN: function(cb){
				GSTIN.findOne({value: req.body.gstin}).exec(cb);
			},
			findSubsciption:['getPlan', 'getGSTIN', function(results, cb){
				var filter = {status:['active', 'created'], plan: results.getPlan.id}
				if(results.getGSTIN)
					filter.gstin = results.getGSTIN.id;
				Subscription.find(filter).exec(function(err, ss){
					if(err) return cb(err);
					if(ss.length) return cb(new Error('SUBSCRIPTION_FOUND'))
					return cb(null);
				});
			}],
			createInRazorpay: ['findSubsciption', function(results, cb){
				RazorpayService.instance.subscriptions.create({
					"plan_id": results.getPlan.pg_plan_id,
					"total_count":req.body.plan == '1'? 12:1,
					"quantity": 1,
					"customer_notify":1,
					"notify_info":{
						"notify_email": req.user.email
					  }
				}, 
				cb)
			}],
			createSubscription: ['createInRazorpay', function(results,cb){
				Subscription.create({
					pg_subscription_id: results.createInRazorpay.id,
					plan: results.getPlan.id,
					status:results.createInRazorpay.status,
					quantity: results.createInRazorpay.quantity,
					start_at: new Date(results.createInRazorpay.start_at *1000),
					user: req.user.id,
					gstin: results.getGSTIN? results.getGSTIN.id: null,
					details: {
						subscription_link: results.createInRazorpay.short_url
					}
				}).exec(cb);
			}]
		}, function(err, results){
			if(err){
				switch (err.message) {
					case 'SUBSCRIPTION_FOUND':
						return res.status(400).json({'error': 'an existing subscription found with the details'})
						break;
					default:
						return res.status(500).json({error: err.message});
						break;
				}
			}
			return res.json({subscription_link: results.createInRazorpay.short_url})
		})
	},
	viewMonth:function(req,res){


		async.auto({
			getInvoices:function(callback){
				var start_date= new Date(req.params.month);
				var end_date = new Date(req.params.month);
				end_date.setMonth(end_date.getMonth()+1);
				var filter={
					and:[
						{gstin:req.gstin.id},
						{
							date:{
								'>=':start_date.toISOString(),
								'<':end_date.toISOString(),
							}
						}

						// {date:{'<':'2019-11-01'}}
					]
				}
				Invoice.find(filter).sort('date DESC').exec(callback);
			}
		},function(err,results){
			if(err)
				throw err;
			var locals={
				invoices:results.getInvoices,
			};
			
			res.view('view_month',locals);
		})
	},
	uploadGst3bStatus:function(req,res){
		var locals={};
		Filing.findOne({id:req.params.filing_id}).exec(function(err,filing){
			if(!req.body){
				locals.filing=filing;
				res.view('upload_gstr3b_status',locals);
			}else{
				async.auto({
					uploadFile:function(cb){
						req.file('files').upload(function (err, uploadedFiles) {
							if (err) 
								return cb(err);
							cb(null, uploadedFiles);
						});
					},
					uploadOriginalFileToS3:['uploadFile',function(results,cb){
						var u_file=results.uploadFile[0];
						var s3 = new AWS.S3({
							accessKeyId: sails.config.aws.key,
							secretAccessKey: sails.config.aws.secret,
							region: sails.config.aws.region
						});
						var params = {Bucket: sails.config.aws.bucket, 
							Key: _.get(u_file, 'stream.fd'), 
							Body: fs.createReadStream(u_file.fd),
							ContentType:u_file.type,
						};
						s3.upload(params, function(err, data) {
							cb(err, data);
						});
					}],
					createDocument:['uploadFile','uploadOriginalFileToS3',function(results,cb){
						var u_file=results.uploadFile[0];
						var s3doc=results.uploadOriginalFileToS3;
						var doc={
							filename:u_file.filename,
							filetype:u_file.type,
							type:'gstr3b_status',
							filing:filing.id,
							size:u_file.size,
							location:s3doc.Location,
							gstin:req.gstin.id
						}
						Document.create(doc).fetch().exec(cb);
					}],
					updateFiling:['createDocument',function(results,cb){
						var details=filing.details;
						details.gstr3b_status=req.body;
						delete details.gstr3b_status.files;
						Object.keys(details.gstr3b_status).forEach(function(key){
							if(details.gstr3b_status[key]=='')
								details.gstr3b_status[key]=0;
							else
								details.gstr3b_status[key]=parseFloat(details.gstr3b_status[key]);
						})
						details.gstr3b_status.doc=results.createDocument;
						Filing.updateOne({id:filing.id},{details:details}).exec(cb);
					}]
				},function(err,results){
					if(err)
						throw err;
					res.redirect('/gstin/'+req.gstin.value+'/filing/'+req.params.filing_id);
				})
			}
		})
		
	},
	editGst3bStatus:function(req,res){
		var locals={};
		Filing.findOne({id:req.params.filing_id}).exec(function(err,filing){
			if(!req.body){
				locals.filing=filing;
				res.view('upload_gstr3b_status',locals);
			}else{
				async.auto({
					updateFiling:function(cb){
						var details=filing.details;
						var doc= filing.details.gstr3b_status.doc;
						details.gstr3b_status=req.body;
						delete details.gstr3b_status.files;
						Object.keys(details.gstr3b_status).forEach(function(key){
							if(details.gstr3b_status[key]=='')
								details.gstr3b_status[key]=0;
							else
								details.gstr3b_status[key]=parseFloat(details.gstr3b_status[key]);
						})
						details.gstr3b_status.doc=doc;
						Filing.updateOne({id:filing.id},{details:details}).exec(cb);
					}
				},function(err,results){
					if(err)
						throw err;
					res.redirect('/gstin/'+req.gstin.value+'/filing/'+req.params.filing_id);
				})
			}
		})
		
	},
	getDocument:function(req,res){
		Document.findOne({id:req.params.doc_id,gstin:req.gstin.id}).exec(function(err,doc){
			if(!doc)
				return res.send('no such document under this gstin');
			var params={
				Bucket: doc.location.split('/')[2].split('.')[0],
				Key: doc.location.split('/')[3],
			}
			var s3 = new AWS.S3({
				accessKeyId: sails.config.aws.key,
				secretAccessKey: sails.config.aws.secret,
				region: sails.config.aws.region
			});
			s3.getSignedUrl('getObject', params, function(err, url){
				// console.log(url);
				res.redirect(url);
			}); 
		})
		
		// var params = {Bucket: sails.config.aws.bucket, 
		//     Key: _.get(u_file, 'stream.fd'), 
		//     Body: fs.createReadStream(u_file.fd)
		// };
		// s3.getObject(params, function (err, data) {
		//     if (err) return callback(err);
		//     // an error occurred
		//     if (data) {
		//         return callback(null, data);
		//     } else {
		//         var e = new Error("Unable to find the document");
		//         e.statusCode = 404;
		//         e.readable_message = "Unable to find the document";
		//         return callback(e, null);
		//     }
		// });
	},
	listDocs:function(req,res){
		var locals={};
		var filters = {
			gstin:req.gstin.id,
		}


		Document.find(filters)
		.sort('createdAt DESC').exec(function(err,docs){
			if(err)
				throw err;
			locals.docs=docs;
			res.view('list_docs',locals);
		})
	},
	viewDoc:function(req,res){
		Document.findOne({id:req.params.d_id}).populate('invoice').exec(function(err,doc){
			var locals={
				doc:doc,
			}
			if(!doc)
				res.send('This document does not exist');
			res.view('view_doc',locals);
		});
	},
	docUpdateExtractedData:function(req,res){
		async.auto({
			getDocument:function(callback){
				Document.findOne({id:req.params.d_id,gstin:req.gstin.id}).exec(callback);
			},
			updateDocument:['getDocument',function(results,callback){
				var details=results.getDocument.details;
				req.body.amount_no_tax=req.body.amount_no_tax?parseFloat(req.body.amount_no_tax):0;
				req.body.cgst=req.body.cgst?parseFloat(req.body.cgst):0;
				req.body.sgst=req.body.sgst?parseFloat(req.body.sgst):0;
				req.body.igst=req.body.igst?parseFloat(req.body.igst):0;
				req.body.amount_including_tax=req.body.amount_including_tax?parseFloat(req.body.amount_including_tax):0;
				details.extracted_data=req.body;
				Document.updateOne({id:req.params.d_id},{details:details}).exec(callback);
			}]
		},function(err,results){
			res.redirect('/gstin/'+req.gstin.value+'/document/'+req.params.d_id);
		});
	},

	docCreateInvoice:function(req,res){
		Document.findOne({id:req.params.d_id}).exec(function(err,doc){
			var locals={
				doc:doc,
			}
			var data=doc.details.extracted_data;
			if(data.seller_gst_no==req.gstin.value)
				locals.invoice_type='income';
			else if(data.buyer_gst_no==req.gstin.value)
				locals.invoice_type='expense';
			else
				locals.invoice_type='unknown';
			res.view('doc_create_invoice',locals);
		});
	},
	docLinkInvoice:function(req,res){
		var locals={
			invoice:null,
			suggestions:null
		}
		var doc_id = req.params.d_id;
		var invoice_id = req.query.invoice?req.query.invoice:null;
		if(req.body){
			async.auto({
				getDocument:function(callback){
					Document.findOne({id:doc_id,gstin:req.gstin.id}).exec(callback);
				},
				getInvoice:function(callback){
					Invoice.findOne({id:invoice_id,gstin:req.gstin.id}).exec(callback);
				},
				linkDocument:['getDocument','getInvoice',function(results,callback){
					if(results.getDocument && results.getInvoice){
						Document.update({id:doc_id},{invoice:invoice_id}).exec(callback);
					}else{
						callback(new Error('either doc or invoice is not valid'));
					}
				}]
			},function(err,results){
				if(err)
					throw err;
				res.redirect(`/gstin/${req.gstin.value}/document/${doc_id}`);
			})
		}else{
			Document.findOne({id:doc_id,gstin:req.gstin.id}).exec(function(err,doc){
				if(err)
					throw err;
				locals.doc=doc;
				var data=doc.details.extracted_data;
				if(!data || !data.invoice_no)
					return res.send('You can link a document only if the data is extracted from it first. Please extract data first.');
				if(data.seller_gst_no==req.gstin.value)
					locals.invoice_type='income';
				else if(data.buyer_gst_no==req.gstin.value)
					locals.invoice_type='expense';
				else
					locals.invoice_type='unknown';
				if(locals.invoice_type=='unknown')
					return res.send('the document uploaded is neither an expense invoice or an income invoice. The account GST does not match with the buyer or the seller. Cannot link this document');
				if(invoice_id){
					Invoice.findOne({id:invoice_id,gstin:req.gstin.id}).exec(function(err,invoice){
						if(err)
							throw err;
						locals.invoice=invoice;
						res.view('doc_link_invoice',locals);
					})
				}else{ // suggest invoices 
					async.auto({
						getInvoiceWithExactNumber:function(callback){
							var filter = {
								type:locals.invoice_type,
								remote_id:data.invoice_no,
								gstin:req.gstin.id
							}
							if(locals.invoice_type=='income')
								filter.buyer_gst_no=data.buyer_gst_no;
							else 
								filter.seller_gst_no=data.seller_gst_no;
							Invoice.findOne(filter).exec(callback)
						},
						getSimilarInvoices:function(callback){
							var start_date= new Date(data.date);
							start_date.setDate(start_date.getDate()-10);
							var end_date = new Date(data.date);
							end_date.setDate(end_date.getDate()+10);
							var filter={
								and:[
									{gstin:req.gstin.id},
									{type:locals.invoice_type},
									{date:{'>=':start_date.toISOString()}},
									{date:{'<':end_date.toISOString()}}
								]
							}
							if(locals.invoice_type=='income')
								filter.buyer_gst_no=data.buyer_gst_no;
							else 
								filter.seller_gst_no=data.seller_gst_no;
							Invoice.find(filter).exec(callback);
						}
					},function(err,results){
						if(err)
							throw err;
						locals.suggestions={
							exact_match:results.getInvoiceWithExactNumber,
							similar:results.getSimilarInvoices,
						}
						res.view('doc_link_invoice',locals);
					})
				}
			});
		}
		


		// case if the invoice id is not known 

		// case if the invoice id is know
		
	},
	deleteDoc:function(req,res){
		var filter={id:req.params.d_id,gstin:req.gstin.id};
		Document.findOne(filter).populate('invoice').exec(function(err,doc){
			if(err)
				throw err;
			if(!doc)
				return res.send('This document does not exist');
			var locals={
				doc:doc
			};
			if(req.body){
				async.auto({
					deleteDocument:function(callback){
						var filter={id:req.params.d_id,gstin:req.gstin.id};
						Document.destroyOne(filter).exec(callback);
					},
					deleteAssociatedActiveTasks:function(callback){
						var filter={
							status:'open',
							link:`/gstin/${req.gstin.value}/document/${req.params.d_id}`,
						};
						Task.destroy(filter).exec(callback);
					},
				},function(err,results){
					if(err)
						throw err;
					res.redirect(`/gstin/${req.gstin.value}/documents`);
				})
			}else{
				res.view('delete_doc',locals);
			}
		});
	},
	deleteInvoice:function(req,res){
		var filter={id:req.params.i_id,gstin:req.gstin.id};
		Invoice.findOne(filter)
			.populate('gstr3b')
			.populate('gstr1')
			.populate('gstr2a')
			.populate('gstr9')
			.populate('documents')
			.exec(function(err,invoice){
			
			if(err)
				throw err;
			if(!invoice)
				return res.send('This invoice does not exist');

			if(invoice.gstr3b || invoice.gstr2a || invoice.gstr1 || invoice.gstr9)
				invoice.can_delete=false;
			else 
				invoice.can_delete=true;
			var locals={
				invoice:invoice
			};
			if(req.body && invoice.can_delete){
				async.auto({
					deleteInvoice:function(callback){
						var filter={id:req.params.i_id,gstin:req.gstin.id};
						Invoice.destroyOne(filter).exec(callback);
					},
					delinkDocuments:function(callback){
						if(invoice.documents.length>0){
							var doc_ids=_.map(invoice.documents, 'id');
							Document.update({id:doc_ids},{invoice:null}).exec(callback);
						}else{
							callback(null);
						}
					}
				},function(err,results){
					if(err)
						throw err;
					res.redirect(`/gstin/${req.gstin.value}/invoices`);
				})
			}else{
				res.view('delete_invoice',locals);
			}
		});
	},
	createEmailSenderPermission:function(req,res){
		var details=req.gstin.details;
		if(!details.settings)
			details.settings={};
		if(!details.settings.allowed_senders)
			details.settings.allowed_senders=[];

		details.settings.allowed_senders.push(req.body.email);

		GSTIN.updateOne({id:req.gstin.id},{details:details}).exec(function(err,results){
			if(err)
				throw err;
			res.redirect(`/gstin/${req.gstin.value}/settings/email_forwarding`);
		});
	},
	revokeEmailSenderPermission:function(req,res){
		var details=req.gstin.details;
		if(!details.settings)
			details.settings={};
		if(!details.settings.allowed_senders)
			details.settings.allowed_senders=[];
		var allowed_senders=[];
		
		details.settings.allowed_senders.forEach(function(email){
			if(email!=req.body.email)
				allowed_senders.push(email);
		});
		details.settings.allowed_senders=allowed_senders;

		GSTIN.updateOne({id:req.gstin.id},{details:details}).exec(function(err,results){
			if(err)
				throw err;
			res.send({success:'success'});
		});
	},
	listThirdParties:function(req,res){
		var locals={};
		var type = 'expense';
		var gst_type='seller_gst_no';
		if(req.query.type=='sell_to'){
			type='income';
			gst_type='buyer_gst_no';
		}
		if(req.query.type=='buy_from'){
			type='expense';
			gst_type='seller_gst_no';
		}

		
		async.auto({
			getSumAndCount:function(callback){
				var query = `Select ${gst_type},sum(amount_including_tax),count(*) from invoice 
				where gstin=$1 AND type=$2
				group by ${gst_type} 
				order by sum desc;`;
				sails.sendNativeQuery(query,[req.gstin.id,type]).exec(function(err,result){
					callback(err,result.rows);
				});
			},
			getName:function(callback){
				var query = `SELECT DISTINCT ON (${gst_type})
					${gst_type}, third_party
					FROM   invoice
					where gstin=$1 AND type=$2
					ORDER  BY ${gst_type}`;
				sails.sendNativeQuery(query,[req.gstin.id,type]).exec(function(err,result){
					callback(err,result.rows);
				});
			}

		},function(err,results){
			if(err)
				throw err;
			locals.third_parties=results.getSumAndCount;
			locals.third_parties.forEach(function(tp){
				results.getName.forEach(function(tp2){
					if(tp2[gst_type]==tp[gst_type])
						tp.third_party=tp2.third_party;
				})
			})
			res.view('list_third_parties',locals);
		})
	},
	viewThirdParty:function(req,res){
		
		async.auto({
			getIncomeInvoices:function(callback){
				var filter={
					type:'income',
					gstin:req.gstin.id,
					buyer_gst_no:req.params.third_party_gst_no
				}
				Invoice.find(filter)
				.populate('gstr3b')
				.populate('gstr1')
				.populate('gstr2a')
				.populate('gstr9')
				.populate('documents')
				.sort('date DESC').exec(callback);
			},
			getExpenseInvoices:function(callback){
				var filter={
					type:'expense',
					gstin:req.gstin.id,
					seller_gst_no:req.params.third_party_gst_no
				}
				Invoice.find(filter)
				.populate('gstr3b')
				.populate('gstr1')
				.populate('gstr2a')
				.populate('gstr9')
				.populate('documents')
				.sort('date DESC').exec(callback);
			}
		},function(err,results){
			var locals={
				invoices:results.getIncomeInvoices.concat(results.getExpenseInvoices),
				sales:results.getIncomeInvoices,
				purchases:results.getExpenseInvoices,
			};
			if(!locals.invoices.length)
				return res.send('You have not done any business with this 3rd party');
			locals.third_party=locals.invoices[0].third_party;
			res.view('view_third_party',locals);
		})

	},
	listReports:function(req,res){
		var locals={};
		res.view('list_reports',locals);
	},
	viewReport:function(req,res){
		var locals={};
		res.view('view_report',locals);
	},
	viewReportInvoiceWithNoDocs:function(req,res){
		var locals={
			income_invoices:[],
			expense_invoices:[],
		};

		async.auto({
			getInvoices:function(callback){
				var query = `select invoice.*,document.id as doc_id from invoice
					left join document 
					on invoice.id=document.invoice
					where invoice.gstin=$1 AND document.id is null;`
				sails.sendNativeQuery(query,[req.gstin.id]).exec(function(err,result){
					callback(err,result.rows);
				});
			},
			// get income invoices without a document
			// get expense invoices without a document
			// update cache
			updateCache:['getInvoices',function(results,callback){
				var details = req.gstin.details;
				if(!details.cache)
					details.cache={};
				if(!details.cache.reports)
					details.cache.reports={};
				details.cache.reports.invoices_with_no_docs=results.getInvoices.length;
				GSTIN.updateOne({id:req.gstin.id},{details:details}).exec(callback);
			}],

		},function(err,results){
			if(err)
				throw err;
			results.getInvoices.forEach(function(i){
				if(!i.doc_id)
					i.documents=[];
				if(i.type=='income')
					locals.income_invoices.push(i);
				else
					locals.expense_invoices.push(i);
			})
			res.view('reports/invoices_with_no_docs',locals);
		});
	},
	viewReportDocsWithNoInvoice:function(req,res){
		var locals={
			income_invoices:[],
			expense_invoices:[],
		};

		async.auto({
			getDocs:function(callback){
				var filter = {
					gstin:req.gstin.id,
					invoice:null,
				}
				Document.find(filter).sort('createdAt DESC').exec(callback)
			},
			// get income invoices without a document
			// get expense invoices without a document
			// update cache
			updateCache:['getDocs',function(results,callback){
				var details = req.gstin.details;
				if(!details.cache)
					details.cache={};
				if(!details.cache.reports)
					details.cache.reports={};
				details.cache.reports.docs_with_no_invoice=results.getDocs.length;
				GSTIN.updateOne({id:req.gstin.id},{details:details}).exec(callback);
			}],

		},function(err,results){
			if(err)
				throw err;
			locals.docs=results.getDocs;
			res.view('reports/docs_with_no_invoice',locals);
		});
	},
	viewReportGSTR2AInvoicesNotInMA:function(req,res){
		var locals={};
		async.auto({
			getFilings:function(callback){
				var filter ={
					gstin:req.gstin.id,
					type:'gstr2a'
				};
				Filing.find(filter).populate('invoices_gstr2a').sort('for_date DESC').exec(callback);
			},
			updateCache:['getFilings',function(results,callback){
				var details = req.gstin.details;
				if(!details.cache)
					details.cache={};
				if(!details.cache.reports)
					details.cache.reports={};
				var count = 0;
				results.getFilings.forEach(function(filing){
					var b2b_invoices=_.get(filing.details,'portal_data.b2b_invoices',[]);
					// if(!b2b_invoices)
					// 	b2b_invoices=[];
					b2b_invoices.forEach(function(i){
						var related_invoice=_.find(filing.invoices_gstr2a,function(f_inv){
							// invoice numbers and gst numbers should match
							if(f_inv.remote_id.toLocaleUpperCase()==i.no.toLocaleUpperCase() && f_inv.seller_gst_no.toLocaleUpperCase()==i.seller_gstin.toLocaleUpperCase())
								return true;
						})
						if(!related_invoice)
							count ++;
					});
				})
				details.cache.reports.gstr2a_invoices_not_in_ma=count;
				GSTIN.updateOne({id:req.gstin.id},{details:details}).exec(callback);
			}],
		},function(err,results){
			if(err)
				throw err;
			locals.filings=results.getFilings;
			res.view('reports/gstr2a_invoices_not_in_ma',locals);
		})
	},
	viewReportGSTR1InvoicesNotInMA:function(req,res){
		var locals={};
		async.auto({
			getFilings:function(callback){
				var filter ={
					gstin:req.gstin.id,
					type:'gstr1'
				};
				Filing.find(filter).populate('invoices_gstr1').sort('for_date DESC').exec(callback);
			},
			updateCache:['getFilings',function(results,callback){
				var details = req.gstin.details;
				if(!details.cache)
					details.cache={};
				if(!details.cache.reports)
					details.cache.reports={};
				var count = 0;
				results.getFilings.forEach(function(filing){
					var b2b_invoices=_.get(filing.details,'portal_data.b2b_invoices',[]);
					// if(!b2b_invoices)
					// 	b2b_invoices=[];
					b2b_invoices.forEach(function(i){
						var related_invoice=_.find(filing.invoices_gstr1,function(f_inv){
							// invoice numbers and gst numbers should match
							if(f_inv.remote_id.toLocaleUpperCase()==i.no.toLocaleUpperCase() && f_inv.buyer_gst_no.toLocaleUpperCase()==i.buyer_gstin.toLocaleUpperCase())
								return true;
						})
						if(!related_invoice)
							count ++;
					});
				})
				details.cache.reports.gstr1_invoices_not_in_ma=count;
				GSTIN.updateOne({id:req.gstin.id},{details:details}).exec(callback);
			}],
		},function(err,results){
			if(err)
				throw err;
			locals.filings=results.getFilings;
			res.view('reports/gstr1_invoices_not_in_ma',locals);
		})
	},
	connectZoho:function(req,res){

		async function run() {
		  
		  const authorizationUri = client.authorizeURL({
		    redirect_uri: process.env.ZOHO_CALLBACK_URL,
		    scope: 'ZohoInvoice.invoices.ALL',
		    access_type:'offline',
			prompt:'consent',
			state:req.gstin.value
		  });
		  res.redirect(authorizationUri);
		}run();

	},
	zohoCallback:async function(req,res){
		const tokenParams = {
		  code: req.query.code,
		  redirect_uri: process.env.ZOHO_CALLBACK_URL,
		  scope: req.query.scope,
		};
		var locals={};

		try {
			const accessToken = await client.getToken(tokenParams);
			// console.log(accessToken.expired());
			// const newToken = await accessToken.refresh();
			var token_details= {
				zoho_tokens:accessToken.token,
				zoho_refresh_token:accessToken.token.refresh_token,
				zohoId: '',
			};
			async.auto({
				getGSTIN:function(callback){
					GSTIN.findOne({value:req.query.state}).exec(function(err,result){
						callback(err,result);
					});
				},
				updateToken:['getGSTIN',function(results,callback){
					GSTIN.updateOne({id:results.getGSTIN.id},{details:token_details}).exec(callback);
				}],
	
			},function(err,results){
				if(err)
					throw err;
				locals.tokenDetails= results.getGSTIN.details;
				
				res.redirect('/gstin/'+req.query.state+'/settings/integration');
			});
		} catch (error) {
			console.log('Access Token Error', error.message);
		}
	},
	
	listZohoInvoices:async function(req,res){
		var locals ={};
		async.auto({
			getToken:function(callback){
				GSTIN.findOne({value:req.params.gst_no}).exec(function(err,result){
					callback(err,result.details);
				});
			},
			getInvoices:['getToken',async function(results,callback){
				var request = require('request');
				var storedAccessTokenFromDB=JSON.parse(`{"access_token":"${results.getToken.zoho_tokens.access_token}","refresh_token":"${results.getToken.zoho_refresh_token}","api_domain":"${results.getToken.zoho_tokens.api_domain}","token_type":"${results.getToken.zoho_tokens.token_type}","expires_in":"${results.getToken.zoho_tokens.expires_in}","expires_at":"${results.getToken.zoho_tokens.expires_at}"}`);
				console.log('storedAccessToken-------',storedAccessTokenFromDB);
				async function updateZohoInfo(){
					var updated_details={
						zoho_tokens : accessToken.token,
						zoho_refresh_token: results.getToken.zoho_refresh_token,
						zohoId: results.getToken.zohoId ? results.getToken.zohoId : req.query.zohoID,
					};
						await GSTIN.updateOne({id:req.gstin.id},{details:updated_details});
				};
				var accessToken = client.createToken(storedAccessTokenFromDB);
					if (accessToken.expired()) {
					try {
						const refreshParams = {
						  scope: 'ZohoInvoice.invoices.ALL',
						};
				   
						accessToken = await accessToken.refresh(refreshParams);
						updateZohoInfo();
					  } catch (error) {
						console.log('Error refreshing access token: ', error.message);
					  }
					}	
					else{
						updateZohoInfo();
					}
					
				
				var options = {
					'method': 'GET',
					'url': `${process.env.ZOHO_ADMIN_INVOICE_API}`,
					'headers': {
						'Authorization': 'Zoho-oauthtoken '+ accessToken.token.access_token,
						'X-com-zoho-invoice-organizationid': req.query.zohoID,
						'Content-Type': 'multipart/form-data',
					}
				};
				request(options, function (error, response) { 
					if (error) throw new Error(error);
					console.log(response.body);
					locals.invoice_details = JSON.parse(response.body);
					res.view('zohoInvoice', locals);
				});
			}],

		},function(err,results){
			if(err)
				throw err;
			// locals.invoice_details = results
			// res.view('zohoInvoice', locals);
		});

	},
}