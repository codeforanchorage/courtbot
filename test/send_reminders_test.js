'use strict';
require('dotenv').config();
const sr = require("../sendReminders.js");
const sendReminders = sr.sendReminders;
const findReminders = sr.findReminders;
const expect = require("chai").expect;
const sinon = require('sinon')
const manager = require("../utils/db/manager");
const db = require('../db');
const knex = manager.knex;
const messages = require('../utils/messages')

const dates = require("../utils/dates"),
    TEST_CASE_ID = "677167760f89d6f6ddf7ed19ccb63c15486a0eab",
    TEST_UTC_DATE = "2015-03-27T08:00:00" + dates.timezoneOffset("2015-03-27");

describe("with one reminder that hasn't been sent", function() {
    let messageStub

    beforeEach(function () {
       messageStub = sinon.stub(messages, 'send')
       messageStub.resolves(true)

       return manager.ensureTablesExist()
            .then(clearTable("cases"))
            .then(clearTable("reminders"))
            .then(loadCases([case1]))
            .then(addTestReminders([reminder1]))
    });

    afterEach(function() {
        messageStub.restore()
    });

    it("sends the correct info to Twilio and updates the reminder to sent", function() {
        var message = `Reminder: It appears you have a court hearing tomorrow at 2:00 PM at NEWROOM. You should confirm your hearing date and time by going to ${process.env.COURT_PUBLIC_URL}. - ${process.env.COURT_NAME}`;
        return knex("cases").update({date: dates.todayAtHour(14).add(1, 'days'), time: '02:00:00 PM', room: 'NEWROOM' })
        .then(() => sendReminders())
        .then(() => knex("reminders").where({ sent: true }).select("*"))
        .then(function (rows) {
            sinon.assert.calledWith(messageStub, reminder1.phone, process.env.TWILIO_PHONE_NUMBER, message)
            expect(rows.length).to.equal(1);

        });
    });
});

describe("with three reminders (including one duplicate) that haven't been sent", function () {
    let messageMock

    beforeEach(function () {
        messageMock = sinon.mock(messages)
        //messageExpectation.resolves(true)

        return manager.ensureTablesExist()
            .then(clearTable("cases"))
            .then(clearTable("reminders"))
            .then(loadCases([case1, case2]))
            .then(addTestReminders([reminder1, reminder2, reminder2_dup]))
    });

    afterEach(function() {
        messageMock.restore()
    });

    it("sends the correct info to Twilio and updates the reminder(s) to sent", function () {
        var message = `Reminder: It appears you have a court hearing tomorrow at 2:00 PM at NEWROOM. You should confirm your hearing date and time by going to ${process.env.COURT_PUBLIC_URL}. - ${process.env.COURT_NAME}`;
        messageMock.expects('send').resolves(true).once().withExactArgs(reminder1.phone, process.env.TWILIO_PHONE_NUMBER, message)
        messageMock.expects('send').resolves(true).twice().withExactArgs(reminder2.phone, process.env.TWILIO_PHONE_NUMBER, message)

        return knex("cases").update({ date: dates.todayAtHour(14).add(1, 'days'), time: '02:00:00 PM', room: 'NEWROOM' })
        .then(() =>  sendReminders())
        .then(res =>  knex("reminders").where({ sent: true }).select("*"))
        .then(rows => {
            messageMock.verify()
            expect(rows.length).to.equal(3);
        });
    });
});

function loadCases(cases) {
    return function() {
        return knex("cases").insert(cases);
    }
}

function addTestReminders(reminders) {
    return function () {
        return Promise.all(reminders.map(function (reminder) {
            return addTestReminder(reminder);
        }));
    }
}

function addTestReminder(reminder) {
    return db.addReminder({
        caseId: reminder.caseId,
        phone: reminder.phone,
        originalCase: reminder.originalCase
    });
}

function clearTable(table) {
    return function() {
        return knex(table).del()
    };
}

var case1 = {
    //date: '27-MAR-15',
    date: TEST_UTC_DATE,
    defendant: 'TURNER, FREDERICK T',
    room: 'CNVCRT',
    time: '01:00:00 PM',
    citations: '[{"id":"4928456","violation":"40-8-76.1","description":"SAFETY BELT VIOLATION","location":"27 DECAATUR ST"}]',
    id: "677167760f89d6f6ddf7ed19ccb63c15486a0eab"
}

var case2 = {
    //date: '27-MAR-15',
    date: TEST_UTC_DATE,
    defendant: 'SMITH, Bob J',
    room: 'CNVJAIL',
    time: '01:00:00 PM',
    citations: '[{"id":"4928457","violation":"40-8-78.1","description":"DRIVING TO SLOW...","location":"22 NUNYA DR"}]',
    id: "677167760f89d6f6ddf7ed19ccb63c15486a0eac"
}

var reminder1 = {
    caseId: case1.id,
    phone: "+12223334444",
    originalCase: case1
}

var reminder2 = {
    caseId: case2.id,
    phone: "+12223334445",
    originalCase: case2
}

var reminder2_dup = {
    caseId: case2.id,
    phone: "+12223334445",
    originalCase: case2
}
