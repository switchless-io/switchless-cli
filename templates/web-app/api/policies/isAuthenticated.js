module.exports = function(req, res, next) {
   	if (req.isAuthenticated()) {
   		return next();
    }
    else{
	    res.set('sl_status','access_denied')
        // res.view('login_page',locals);
        res.redirect('/login?redirect='+encodeURIComponent(req.url));
    }
};
