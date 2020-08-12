var async = require('async');

var Bull = require( 'bull' );
var crawlerQueue = new Bull('crawler',{redis:sails.config.bull.redis});

// const { ClientCredentials, ResourceOwnerPassword, AuthorizationCode } = require('simple-oauth2');
const zohoInvoiceAdmin_config = {
	client: {
		id:  process.env.ZOHO_ADMIN_CLIENT_ID,
		secret: process.env.ZOHO_ADMIN_CLIENT_SECRET
	},
	auth: {
		tokenHost: `${process.env.ZOHO_TOKEN_HOST_URL}`,
		tokenPath: '/oauth/v2/token',
		authorizePath: '/oauth/v2/auth',
	}
};
// const zoho_admin = new AuthorizationCode(zohoInvoiceAdmin_config);

module.exports={
	adminLanding:function(req,res){
		res.view('admin/landing_page');
	},
	listGSTINs:function(req,res){
		var locals={};
		async.auto({
			getAllGSTINs:function(callback){
				GSTIN.find({}).sort('createdAt DESC').exec(callback);
			}
		},function(err,results){
			var locals={
				gstins:results.getAllGSTINs,
			}
			res.view('admin/list_gstins',locals);
		})
	},
	viewGSTIN:function(req,res){
		var locals={};
		async.auto({
			getGSTIN:function(callback){
				GSTIN.findOne({value:req.params.gst_no}).exec(callback);
			}
		},function(err,results){
			var locals={
				gstin:results.getGSTIN,
			}
			res.view('admin/view_gstin',locals);
		})
	},
	listFilings:function(req,res){
		var filter={};
		if(req.query.type)
			filter.type=req.query.type;

		async.auto({
			getGSTIN:function(callback){
				if(req.query.gstin){
					GSTIN.findOne({value:req.query.gstin}).exec(function(err,gstin){
						filter.gstin=gstin.id;
						callback(err);
					});
				}else{
					callback(null);
				}
			},
			getFilings:['getGSTIN',function(results,callback){
				Filing.find(filter).populate('gstin').sort('for_date DESC').exec(callback);
			}]
		},function(err,results){
			var locals={
				filings:results.getFilings,
			}
			res.view('admin/list_filings',locals);
		})
	},
	// this is to be deleted
	editFilingStatus:function(req,res){
		Filing.update({id:req.params.f_id},req.body).exec(function(err,results){
			res.redirect(req.headers.referer);
		})
	},
	reportMRR:function(req,res){
		var locals={};
		var filter={
			plan:{
				'!=':'inactive',
			}
		};
		async.auto({
			getPayingGSTINs:function(callback){
				GSTIN.find(filter).sort('createdAt DESC').exec(callback);
			},
			getMRR:function(callback){
				GSTIN.sum('mrr',filter).exec(callback);	
			},
			getPayingCustomerCount:function(callback){
				filter.mrr={
					'>':0,
				}
				GSTIN.count(filter).exec(callback);
			}
		},function(err,results){
			var locals={
				gstins:results.getPayingGSTINs,
				mrr:results.getMRR,
				paying_customers:results.getPayingCustomerCount,
			}
			res.view('admin/report_mrr',locals)
		})
	},
	reportFilingStatus:function(req,res){
		var locals={};
		var filter={
			plan:{
				'!=':'inactive',
			}
		};
		async.auto({
			getPayingGSTINs:function(callback){
				GSTIN.find(filter).sort('createdAt DESC').exec(callback);
			},
			getLatestFilings:['getPayingGSTINs',function(results,callback){
				async.each(results.getPayingGSTINs,function(gstin,next){
					console.log(gstin.business_name);
					var date = new Date();
					date.setMonth(date.getMonth()-1);
					var filter = {
						gstin:gstin.id,
						for_date:{
							'<':date,
						}
					}
					async.auto({  
						getGSTR2a:function(callback){
							filter.type='gstr2a';
							Filing.find(filter).sort('for_date DESC').limit(1).exec(callback);
						},
						getGSTR1:function(callback){
							filter.type='gstr1';
							Filing.find(filter).sort('for_date DESC').limit(1).exec(callback);
						},
						getGSTR3b:function(callback){
							filter.type='gstr3b';
							Filing.find(filter).sort('for_date DESC').limit(1).exec(callback);
						},
						getGSTR9:function(callback){
							filter.type='gstr9';
							Filing.find(filter).sort('for_date DESC').limit(1).exec(callback);
						},
						getFilingsCount:function(callback){
							var filter = {
								gstin:gstin.id,
								for_date:{
									'<':date,
								}
							}
							Filing.count(filter).exec(callback);	
						}
					}, function(error, results){
						gstin.latest={
							gstr2a:results.getGSTR2a[0],
							gstr3b:results.getGSTR3b[0],
							gstr1:results.getGSTR1[0],
							gstr9:results.getGSTR9[0],
						}
						gstin.filings_count=results.getFilingsCount;
						next(error);
					})
				},function(err){
					callback(err)
				});
			}]
			// getMRR:function(callback){
			// 	GSTIN.sum('mrr',filter).exec(callback);	
			// }
		},function(err,results){
			var locals={
				gstins:results.getPayingGSTINs,
				mrr:results.getMRR,
			}
			res.view('admin/report_filing_status',locals)
		})
	},
	ZohoAdmin:function(req,res){
		var locals ={};
		var request = require('request-promise');
		var qs = require('querystring');
		const zoho_url = `${process.env.ZOHO_TOKEN_HOST_URL}`+'/oauth/v2/token'+ '?' + 'refresh_token=' + process.env.ZOHO_ADMIN_REFRESH_TOKEN + '&client_id=' + process.env.ZOHO_ADMIN_CLIENT_ID + '&client_secret=' + process.env.ZOHO_ADMIN_CLIENT_SECRET + '&grant_type=refresh_token';
		async.auto({
			getToken:async function(callback){
				var options = {
					'method': 'POST',
					'url': zoho_url,
					};
					var result = await request(options, function (error, response, body) {
						if (error)
						throw new Error(error);
						console.log(response.body);
						locals.token_details = JSON.parse(response.body);
						})
			},
			getInvoices:['getToken',function(callback){
				var invoice_options = {
					'method': 'GET',
					'url': `${process.env.ZOHO_ADMIN_INVOICE_API}`,
					'headers': {
						'Authorization': 'Zoho-oauthtoken '+ locals.token_details.access_token,
						'X-com-zoho-invoice-organizationid': process.env.ZOHO_ADMIN_ORG_ID,
						'Content-Type': 'multipart/form-data',
					}
				};
				request(invoice_options, function (error, response) { 
					if (error) throw new Error(error);
					console.log(response.body);
					locals.invoice_details = JSON.parse(response.body);
					res.view('zohoInvoice', locals);
				});
			}],
		},function(err,results){
			if(err)
				throw err;
		});
	},
	crawlGSTR2A:function(req,res){
		if(!req.body){
			// when getting the GET request
			async.auto({
				getGSTIN:function(callback){
					GSTIN.findOne({value:req.params.gst_no}).exec(callback);
				},
				getFilings:['getGSTIN',function(results,callback){
					var filter = {
						gstin:results.getGSTIN.id,
						type:'gstr2a'
					}
					Filing.find(filter).sort('for_date DESC').exec(callback);
				}]
			},function(err,results){
				var locals={
					gstin:results.getGSTIN,
					filings:results.getFilings,
				}
				res.view('admin/crawl_gstr2a',locals);
			})
		}else{
			// when submitting the form 
			// create the task here. 
			
			// asdfasfd
			async.auto({
				getGSTIN:function(callback){
					GSTIN.findOne({value:req.params.gst_no}).exec(callback);
				},
				getFilings:['getGSTIN',function(results,callback){
					var filing_ids = Object.keys(req.body);
					Filing.find({id:filing_ids}).sort('for_date DESC').exec(callback);
				}],
			},function(err,results){
				var gstin =results.getGSTIN;
				var run_config = {
					"mralbert_host": "https://app.mralbert.in",
					// "client_slug": "sv_engineering",
					"client": {
						// "slug": "sv_engineering",
						"name": gstin.business_name,
						"username": _.get(gstin.details,'config.portal_username'),
						"password": _.get(gstin.details,'config.portal_password'),
						// "plan_type": "filing",
						"gstin": gstin.value,
						// "first_month": "Feb 2020",
						"dob": _.get(gstin.details,'config.dob'),
						// "gstr1_frequency": "monthly",
						"specific_filings": _.map(results.getFilings,'for')
					}
				}
				var data={
					title:'Crawl data from GST portal - GSTR2A - Audit',
					options:{
						what:'gstr2a',
						mode:'audit',
						gstin:req.params.gst_no,
						run_config:run_config
					},
				};
				
				promise = crawlerQueue.add('crawl',data);
				GeneralService.p2c(promise,function(err){
					if(err)
						throw err;
					res.redirect('/admin/gstin/'+req.params.gst_no+'/crawl_gstr2a?success=success');
				});			
			})
		}
	},
	crawlGSTR3B:function(req,res){
		if(!req.body){
			// when getting the GET request
			async.auto({
				getGSTIN:function(callback){
					GSTIN.findOne({value:req.params.gst_no}).exec(callback);
				},
				getFilings:['getGSTIN',function(results,callback){
					var filter = {
						gstin:results.getGSTIN.id,
						type:'gstr3b'
					}
					Filing.find(filter).sort('for_date DESC').exec(callback);
				}]
			},function(err,results){
				var locals={
					gstin:results.getGSTIN,
					filings:results.getFilings,
				}
				res.view('admin/crawl_gstr3b',locals);
			})
		}else{
			// when submitting the form 
			// create the task here. 
			async.auto({
				getGSTIN:function(callback){
					GSTIN.findOne({value:req.params.gst_no}).exec(callback);
				},
				getFilings:['getGSTIN',function(results,callback){
					var filing_ids = Object.keys(req.body);
					Filing.find({id:filing_ids}).sort('for_date DESC').exec(callback);
				}],
			},function(err,results){
				var gstin =results.getGSTIN;
				var run_config = {
					"mralbert_host": "https://app.mralbert.in",
					// "client_slug": "sv_engineering",
					"client": {
						// "slug": "sv_engineering",
						"name": gstin.business_name,
						"username": _.get(gstin.details,'config.portal_username'),
						"password": _.get(gstin.details,'config.portal_password'),
						// "plan_type": "filing",
						"gstin": gstin.value,
						// "first_month": "Feb 2020",
						"dob": _.get(gstin.details,'config.dob'),
						// "gstr1_frequency": "monthly",
						"specific_filings": _.map(results.getFilings,'for')
					}
				}
				var data={
					title:'Crawl data from GST portal - GSTR3B - Audit',
					options:{
						what:'gstr3b',
						mode:'audit',
						gstin:req.params.gst_no,
						run_config:run_config
					},
				};
				
				promise = crawlerQueue.add('crawl',data);
				GeneralService.p2c(promise,function(err){
					if(err)
						throw err;
					res.redirect('/admin/gstin/'+req.params.gst_no+'/crawl_gstr3b?success=success');
				});			
			})
			
		}
	},
	crawlGSTR1:function(req,res){
		if(!req.body){
			// when getting the GET request
			async.auto({
				getGSTIN:function(callback){
					GSTIN.findOne({value:req.params.gst_no}).exec(callback);
				},
				getFilings:['getGSTIN',function(results,callback){
					var filter = {
						gstin:results.getGSTIN.id,
						type:'gstr1'
					}
					Filing.find(filter).sort('for_date DESC').exec(callback);
				}]
			},function(err,results){
				var locals={
					gstin:results.getGSTIN,
					filings:results.getFilings,
				}
				res.view('admin/crawl_gstr1',locals);
			})
		}else{
			// when submitting the form 
			// create the task here. 
			async.auto({
				getGSTIN:function(callback){
					GSTIN.findOne({value:req.params.gst_no}).exec(callback);
				},
				getFilings:['getGSTIN',function(results,callback){
					var filing_ids = Object.keys(req.body);
					Filing.find({id:filing_ids}).sort('for_date DESC').exec(callback);
				}],
			},function(err,results){
				var gstin =results.getGSTIN;
				var run_config = {
					"mralbert_host": "https://app.mralbert.in",
					// "client_slug": "sv_engineering",
					"client": {
						// "slug": "sv_engineering",
						"name": gstin.business_name,
						"username": _.get(gstin.details,'config.portal_username'),
						"password": _.get(gstin.details,'config.portal_password'),
						// "plan_type": "filing",
						"gstin": gstin.value,
						// "first_month": "Feb 2020",
						"dob": _.get(gstin.details,'config.dob'),
						// "gstr1_frequency": "monthly",
						"specific_filings": _.map(results.getFilings,'for')
					}
				}
				var data={
					title:'Crawl data from GST portal - GSTR1 - Audit',
					options:{
						what:'gstr1',
						mode:'audit',
						gstin:req.params.gst_no,
						run_config:run_config
					},
				};
				
				promise = crawlerQueue.add('crawl',data);
				GeneralService.p2c(promise,function(err){
					if(err)
						throw err;
					res.redirect('/admin/gstin/'+req.params.gst_no+'/crawl_gstr1?success=success');
				});			
			})
		}
	}

}