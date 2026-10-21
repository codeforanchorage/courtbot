'use strict';
// setup ENV dependencies
require('dotenv').config();
const fs = require('fs');
const expect = require('chai').expect;
const cookieParser = require('cookie-parser');
const Keygrip = require('keygrip');
const db = require('../db.js');
const manager = require('../utils/db/manager');
const moment = require('moment-timezone');
const knex = manager.knex;
const app = require('../web');
const messages = require('../utils/messages');
const session = require('supertest-session');

const TEST_UTC_DATE = moment("2015-03-27T13:00:00").tz(process.env.TZ).format();
const keys = Keygrip([process.env.COOKIE_SECRET])

/**
 * Altered this to do a local read of the expected content to get expected content length because
 * on windows machine the content length was 354 and not the hard-coded 341 (maybe windows character encoding?)
 *
 * It is partly a guess that it is okay to make this change because I am assuming the unit tests
 * only should run where app.settings.env == 'development' (web.js) -- this is what causes public/index.html
 * to be served, rather than "hello I am courtbot..."
 */
describe("GET /", function() {
    let sess;
    beforeEach(function() {
        sess = session(app);
    })
    afterEach(function(){
        sess.destroy();
    })
    it("responds with web form test input", function(done) {
        var expectedContent = fs.readFileSync("public/index.html", "utf8");
        sess.get('/')
        .expect('Content-Length', expectedContent.length.toString())
        .expect(200)
        .end(function(err, res) {
            if (err) return done(err);
            expect(res.text).to.contain("Impersonate Twilio");
            done();
        });
    });
});

describe("GET /cases", function() {
    let sess;
    beforeEach(function() {
        sess = session(app);
    })
    afterEach(function(){
        sess.destroy();
    })
    it("400s when there is no ?q=", function(done) {
        sess.get('/cases')
        .expect(400, done);
    });

    it("200s + empty array when there is ?q=", function(done) {
        sess.get('/cases?q=test')
        .expect(200)
        .end(function(err, res) {
            if (err) return done(err);
            expect(res.text).to.equal("[]");
            done();
        });
    });

    it("finds partial matches of name", function(done) {
        knex('hearings').del().then(function() {
        knex('hearings').insert([turnerData(1), turnerData(2)]).then(function() {
            sess.get('/cases?q=turner')
            .expect(200)
            .end(function(err, res) {
                if (err) return done(err);
                expect([sortObject(JSON.parse(res.text)[0]),sortObject(JSON.parse(res.text)[1])]).to.deep.equal([turnerDataAsObject(1), turnerDataAsObject(2)]);
                done();
            });
        });
        });
    });

    it("finds exact matches of id", function(done) {
        knex('hearings').del()
        .then(() => knex('hearings').insert([turnerData()]))
        .then(() => {
            sess.get('/cases?q=A4928456')
            .expect(200)
            .end(function(err, res) {
                if (err) return done(err);
                expect(sortObject(JSON.parse(res.text))["0"]).to.deep.equal(turnerDataAsObject());
                done();
            });
        });
    });

    it("finds find id with leading and trailing spaces", function(done) {
        knex('hearings').del()
        .then(() =>  knex('hearings').insert([turnerData()]))
        .then(() => {
            sess.get('/cases?q=%20A4928456%20')
            .expect(200)
            .end(function(err, res) {
                if (err) return done(err);
                expect(sortObject(JSON.parse(res.text))["0"]).to.deep.equal(turnerDataAsObject());
                done();
            });
        });
    });

    it("doesnt find partial matches of id", function(done) {
        knex('hearings').del()
        .then(() => knex('hearings').insert([turnerData()]))
        .then(() => {
            sess.get('/cases?q=492845')
            .expect(200)
            .end(function(err, res) {
                if (err) return done(err);
                expect(JSON.parse(res.text)).to.deep.equal([]);
                done();
            });
        });
    });
});

describe("POST /sms", function() {
    let sess;
    const  new_date = moment().add(5, 'days');

    beforeEach(function() {
        sess = session(app);
        return knex('hearings').del()
        .then(() => knex('notifications').del())
        .then(() => knex('requests').del())
        .then(() => knex('hearings').insert([turnerData('', new_date)]))
    })
    afterEach(function () {
        sess.destroy();
    });

    const referral = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${messages.newServiceReferral()}</Message></Response>`;

    /* The Alaska Court System now runs its own text reminder service, so any
       text that is not managing an existing subscription gets a referral. */
    context("referring people to the court system's text reminders", function() {
        it("replies with the referral for a known case and does not start a sign-up", function(done) {
            sess.post('/sms')
            .send({ Body: " A4928456 ", From: "+12223334444" })
            .expect(200)
            .end(function(err, res) {
                if (err) return done(err);
                expect(res.text).to.equal(referral);
                expect(getConnectCookie(sess).case_id).to.be.undefined;
                expect(getConnectCookie(sess).known_case).to.be.undefined;
                done();
            });
        });

        it("replies with the referral for an unknown citation", function(done) {
            sess.post('/sms')
            .send({ Body: "B1234567", From: "+12223334444" })
            .expect(200)
            .end(function(err, res) {
                if (err) return done(err);
                expect(res.text).to.equal(referral);
                expect(getConnectCookie(sess).case_id).to.be.undefined;
                done();
            });
        });

        it("replies with the referral for input that is not a case number", function(done) {
            sess.post('/sms')
            .send({ Body: "12345", From: "+12223334444" })
            .expect(200)
            .end(function(err, res) {
                if (err) return done(err);
                expect(res.text).to.equal(referral);
                done();
            });
        });

        it("still strips emojis and trailing lines before replying", function(done) {
            sess.post('/sms')
            .send({ Body: 'A4928456 😁\r\n-Simon', From: "+12223334444" })
            .expect(200)
            .end(function(err, res) {
                if (err) return done(err);
                expect(res.text).to.equal(referral);
                done();
            });
        });

        it("mentions the court system's number and info page", function() {
            const msg = messages.newServiceReferral();
            expect(msg).to.contain('(575) 222-8484');
            expect(msg).to.contain('https://courts.alaska.gov/tos/court-guide-reminders-faq.htm');
        });
    });

    context("with session.case_id left over from the old sign-up flow", function() {
        // Build json object, serialize, sign, encode
        var cookieObj = {case_id: turnerData().case_id, known_case: true};
        var cookieb64 = new Buffer(JSON.stringify(cookieObj)).toString('base64');
        var sig = keys.sign('session='+cookieb64);
        var cookieArr = ['session='+cookieb64 + '; session.sig=' + sig + '; Path=/;'];

        it("YES - replies with the referral and does not create a request", function (done) {
            sess.post('/sms').set('Cookie', cookieArr[0]).send({ Body: " yEs ", From: "+12223334444" })
            .expect(200)
            .end(function (err, res) {
                if (err)  return done(err);
                expect(res.text).to.equal(referral);
                expect(getConnectCookie(sess).case_id).to.be.undefined;
                knex("requests").count('* as count')
                .then((rows) => {
                    expect(rows[0].count).to.equal('0');
                })
                .then(done, done)
            });
        });
    });

    describe("Deleting requests", function() {
        const number = '+12223334444'
        const case_id = turnerData().case_id
        const request = {
            case_id: case_id,
            phone: db.encryptPhone(number),
            known_case: true
        }
        beforeEach(function(){
            return knex('hearings').del()
            .then(() => knex('requests').del())
            .then(() => knex('hearings').insert([turnerData()]))
            .then(() => knex('requests').insert([request]))
        })

        describe("Without delete_case_id set on session", function(){
            it("tells them they are subscribed and gives instuction on deleting", function (done){
                const params = { Body: case_id, From: number };
                sess.post('/sms').send(params)
                .expect(200)
                .end(function(err, res){
                    if (err) return done(err)
                    expect(res.text).to.equal(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>You are currently scheduled to receive reminders for this case. We will attempt to text you a courtesy reminder the day before your hearing date. To stop receiving reminders for this case text 'DELETE'. You can go to ${process.env.COURT_PUBLIC_URL} for more information.</Message></Response>`);
                    expect(getConnectCookie(sess).delete_case_id).to.equal('A4928456')
                    done()
                })
            })
        })

        describe("send delete with 'delete_case_id' on session set", function(){
            var cookieObj = {delete_case_id: case_id};
            var cookieb64 = new Buffer(JSON.stringify(cookieObj)).toString('base64');
            var sig = keys.sign('session='+cookieb64);
            var cookieArr = ['session='+cookieb64 + '; session.sig=' + sig + '; Path=/;'];

            it("marks user's request inactive", function(done){
                const params = { Body: " Delete ", From: number };
                sess.post('/sms').set('Cookie', cookieArr).send(params)
                .expect(200)
                .end(function(err, res){
                    if (err) return done(err)
                    expect(res.text).to.equal(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>OK. We will stop sending reminders for case: ${case_id}. If you want to resume reminders you can text this ID to us again. You can go to ${process.env.COURT_PUBLIC_URL} for more information.</Message></Response>`);

                    knex('requests').select('*')
                    .then(rows => {
                        expect(rows.length).to.equal(1)
                        expect(rows[0].active).to.be.false
                    })
                    .then(done, done)
                })
            })
        })

    })
});

function turnerData(v,d) {
  return {
    //date: '27-MAR-15',
    date: d||TEST_UTC_DATE,
    defendant: 'Frederick Turner',
    room: 'CNVCRT',
    case_id: 'A4928456' + (v||""),
    type: null
  };
}

function turnerDataAsObject(v,d) {
    const data = turnerData(v,d);
    data.date = d||TEST_UTC_DATE;
    data.readableDate = moment.utc(d||TEST_UTC_DATE).format("dddd, MMM Do");
    return data;
}

function rawTurnerDataAsObject(v,d) {
    const data = turnerData(v,d);
    data.date = moment(d ||TEST_UTC_DATE).tz(process.env.TZ).format();
    data.today = moment(d).isSame(moment(), 'day')
    data.has_past = moment(d).isBefore(moment())
    return data;
}

function turnerRequest(){
    return {
        case_id: 'A4928456',
        phone: '+12223334444',
        known_case: true
    }
}
function getConnectCookie(sess) {
    if (!sess.cookies) return {}
    const sessionCookie =  sess.cookies.find(cookie => cookie.name === 'session');
    const cookie = sessionCookie && JSON.parse(Buffer.from(sessionCookie['value'], 'base64'));
    return cookie || {}
  }

function sortObject(o) {
    let sorted = {},
        a = [];

    for (let key in o) {
        if (o.hasOwnProperty(key)) {
            a.push(key);
        }
    }

    a.sort();

    for (let key = 0; key < a.length; key++) {
        sorted[a[key]] = o[a[key]];
    }
    return sorted;
}
