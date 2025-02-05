'use strict';

var path = require('path');
var puppeteer = require('puppeteer');
var querystring = require('querystring');
var utils = require('./utils');

var url = 'file://' + path.join(__dirname, 'environment.html');
var page = null;
var browser = null;

describe('mixpanel-lite request', function () {

    // create a new browser instance before each test
    beforeEach(function (done) {

        jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;

        puppeteer.launch({
            headless: true,
            args: []
        })
        .then(function (item) {
            browser = item;
            return browser.newPage();
        })
        .then(function (item) {
            page = item;
            return page.goto(url);
        })
        .then(function() {
            done();
        });
    });

    afterEach(function (done) {

        page.evaluate(function () {
            return localStorage.removeItem('mixpanel-lite');
        })
        .then(function() {
            return utils.sleep(500);
        })
        .then(function() {
            return browser.close();
        })
        .then(function() {
            done();
        });
    });

    it('should sent data to /track endpoint', function (done) {

        var now = (new Date()).getTime();
        var token = 'test-token-' + now;
        var eventName = 'test-event-' + now;

        page.setRequestInterception(true).then(function() {

            // intercept ajax requests
            page.on('request', function(request) {

                var requestUrl = request.url();
                var query = requestUrl.substr(requestUrl.indexOf('?') + 1);
                var params = querystring.parse(query);

                // be sure we've intercepted the correct URL
                expect(requestUrl.startsWith('https://api.mixpanel.com/track')).toEqual(true);

                // confirm it sent the correct params
                expect(params).toBeDefined();
                expect(params._).toBeDefined();
                expect(params.data).toBeDefined();
                expect(params.data).not.toEqual('');

                // decode the data and convert to JSON object so we can inspect
                var data = JSON.parse(Buffer.from(params.data, 'base64').toString('ascii'));

                // check the tracking data we sent is correct
                expect(data.properties).toBeDefined();
                expect(data.properties.distinct_id).toBeDefined();
                expect(data.properties.$browser).toEqual('Chrome');
                expect(data.properties.token).toEqual(token);
                expect(data.event).toEqual(eventName);

                done();
            });

            // execute tracking (pass local vars into dom)
            page.evaluate(function (t, e) {
                window.mixpanel.init(t);
                window.mixpanel.track(e);
            }, token, eventName);
        })
        .catch(done.fail);
    });

    it('should sent data to /engage endpoint', function (done) {

        var now = (new Date()).getTime();
        var token = 'test-token-' + now;
        var email = 'test-email-' + now + '@johndoherty.info';

        page.setRequestInterception(true).then(function() {

            // intercept ajax requests
            page.on('request', function(request) {

                var requestUrl = request.url();
                var query = requestUrl.substr(requestUrl.indexOf('?') + 1);
                var params = querystring.parse(query);

                // be sure we've intercepted the correct URL
                expect(requestUrl.startsWith('https://api.mixpanel.com/engage')).toEqual(true);

                // confirm it sent the correct params
                expect(params).toBeDefined();
                expect(params._).toBeDefined();
                expect(params.data).toBeDefined();
                expect(params.data).not.toEqual('');

                // decode the data and convert to JSON object so we can inspect
                var data = JSON.parse(Buffer.from(params.data, 'base64').toString('ascii'));

                expect(data.$distinct_id).toBeDefined();
                expect(data.$set.$email).toEqual(email);
                expect(data.$token).toEqual(token);

                done();
            });

            // execute tracking (pass local vars into dom)
            page.evaluate(function (t, e) {
                window.mixpanel.init(t);
                window.mixpanel.people.set({ $email: e });
            }, token, email);
        })
        .catch(done.fail);
    });

    it('should send correct number of requests', function (done) {

        var now = (new Date()).getTime();
        var token = 'token-' + now;
        var email = 'test-' + now + '@mixpanel-lite.info';
        var trackRequestCount = 0;
        var engageRequestCount = 0;

        page.setRequestInterception(true).then(function() {

            // intercept ajax requests
            page.on('request', function(request) {

                var requestUrl = request.url();

                // count requests
                if (requestUrl.startsWith('https://api.mixpanel.com/track')) {
                    trackRequestCount++;
                }
                else if (requestUrl.startsWith('https://api.mixpanel.com/engage')) {
                    engageRequestCount++;
                }

                request.continue();
            });

            // execute tracking (pass local vars into dom)
            page.evaluate(function (t, e) {
                window.mixpanel.init(t); // <- no request

                window.mixpanel.track('startup'); // <- track request
                window.mixpanel.track('login'); // <- track request
                window.mixpanel.identify(e); // <- track request
                window.mixpanel.people.set({ roles: ['editor', 'admin'] }); // <- engage request
                window.mixpanel.track('download'); // <- track request
                window.mixpanel.track('logout'); // <- track request
            }, token, email);

            setTimeout(function() {
                expect(trackRequestCount).toEqual(5);
                expect(engageRequestCount).toEqual(1);
                done();
            }, 1500);
        })
        .catch(done.fail);
    });

    it('should not drop any tracking events', async function() {

        var now = new Date().getTime();
        var maxEvents = utils.randomInteger(8, 33);
        var eventsToSend = [];
        var totalEventsSent = 0;

        // create some tracking events
        for (var i = 0; i < maxEvents; i++) {
            eventsToSend.push({
                eventName: `${now}-event-${i}`,
                data: {
                    now: now,
                    index: i
                }
            });
        }

        // setup request intercept
        await page.setRequestInterception(true);

        // intercept and count tracking requests
        page.on('request', function(request) {

            if (request.url().startsWith('https://api.mixpanel.com/track')) {
                totalEventsSent++;
            }

            request.continue();
        });

        // init lib
        await page.evaluate(function () {
            window.mixpanel.init('test-token');
        });

        // send events
        await page.evaluate(function (events) {
            for (var ii = 0, ll = events.length; ii < ll; ii++) {
                window.mixpanel.track(events[ii].eventName, events[ii].data);
            }
        }, eventsToSend);

        // wait a bit for them to send
        await utils.sleep(6000);

        // check we sent the correct number of requests
        expect(totalEventsSent).toEqual(eventsToSend.length);
    });
});
