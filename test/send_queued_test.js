'use strict';
require('dotenv').config();
const sendQueued = require("../sendQueued.js").sendQueued;
const expect = require("chai").expect;
const assert = require("chai").assert;
const now = require("../utils/dates").now;
const manager = require("../utils/db/manager");
const db = require('../db');
const knex = manager.knex;
const sinon = require('sinon')
const messages = require('../utils/messages')

describe("with 2 valid queued cases (same citation)", function() {
    let messageStub
    beforeEach(function() {
        messageStub = sinon.stub(messages, 'send')
        messageStub.resolves(true)

        return manager.ensureTablesExist()
        .then(() => knex('cases').del())
        .then(() => knex('cases').insert([turnerData()]))
        .then(() => knex("queued").del())
        .then(() => db.addQueued({ citationId: "4928456", phone: "+12223334444"}))
        .then(() => db.addQueued({ citationId: "4928456", phone: "+12223334444"}))
    });

    afterEach(function(){
        messageStub.restore()
    });

    it("sends the correct info to Twilio and updates the queued to sent", function() {
        const number = "+12223334444";
        const message = `Hello from the ${process.env.COURT_NAME}. We found a case for Frederick Turner scheduled on Fri, Mar 27th at 1:00 PM, at CNVCRT. Would you like a courtesy reminder the day before a future hearing? (reply YES or NO)`;

        return sendQueued()
        .then(res => knex("queued").select("*"))
        .then(rows => {
            expect(rows[0].sent).to.equal(true);
            expect(rows[0].asked_reminder).to.equal(true);
            expect(rows[0].asked_reminder_at).to.notNull;
            expect(rows[1].sent).to.equal(true);
            expect(rows[1].asked_reminder).to.equal(true);
            expect(rows[1].asked_reminder_at).to.notNull;
            sinon.assert.calledTwice(messageStub)
            sinon.assert.alwaysCalledWithExactly(messageStub, number, process.env.TWILIO_PHONE_NUMBER, message)
        });
    });
});

describe("with a queued non-existent case", function() {
    let messageStub
    beforeEach(function() {
        messageStub = sinon.stub(messages, 'send')
        messageStub.resolves(true)

        return knex('cases').del()
        .then(() => knex('cases').insert([turnerData()]))
        .then(() => knex("queued").del())
        .then(() => db.addQueued({citationId: "123", phone: "+12223334444"}))
    });

    afterEach(function(){
        messageStub.restore()
    });

    it("doesn't do anything < QUEUE_TTL days", function() {
        return sendQueued()
        .then(res =>  knex("queued").select("*"))
        .then(rows => expect(rows[0].sent).to.equal(false))
    });

    it("sends a failure sms after QUEUE_TTL days", function() {
        const number = "+12223334444";
        const message = `We haven't been able to find your court case. You can go to ${process.env.COURT_PUBLIC_URL} for more information. - ${process.env.COURT_NAME}`;
        const mockCreatedDate = now().subtract(parseInt(process.env.QUEUE_TTL_DAYS) + 2, 'days');

        return knex("queued").update({created_at: mockCreatedDate})
        .then(() => sendQueued())
        .then(res =>  knex("queued").select("*"))
        .then(rows => {
            sinon.assert.alwaysCalledWithExactly(messageStub, number, process.env.TWILIO_PHONE_NUMBER, message )
            expect(rows[0].sent).to.equal(true)
        });
    });
});

function turnerData(v) {
    return {
        //date: '27-MAR-15',
        date: '2015-03-27T21:00:00.000Z',
        defendant: 'Frederick Turner',
        room: 'CNVCRT',
        time: '01:00:00 PM',
        citations: '[{"id":"4928456","violation":"40-8-76.1","description":"SAFETY BELT VIOLATION","location":"27 DECAATUR ST"}]',
        id: '677167760f89d6f6ddf7ed19ccb63c15486a0eab' + (v||"")
    }
}
