require('dotenv').config();

const crypto = require('crypto');
const manager = require("../utils/db/manager");
const knex = manager.knex;

/**
 * Details about specific case.
 * @param {*} case_id
 */
function findHearing(case_id) {
    case_id = case_id.toUpperCase().trim();
    return knex.raw(`
    SELECT h.case_id, h.date, h.room, h.type, h.defendant
    FROM hearings h
    WHERE case_id = :case_id
    `, {case_id: case_id})
    .then(r => r.rows)
 }

/**
 * Number of current hearings and the last run of the load script
 */
function hearingCount() {
    return knex.raw(`
    SELECT lr.*, (
        SELECT COUNT(*) FROM hearings
        )
    FROM log_runners lr
    WHERE runner = 'load'
    ORDER BY lr.date DESC LIMIT 1
    `)
    .then(r => r.rows)
}

/**
 * Gets request stats
 * returns a simple object with counts: { scheduled: '3', sent: '10', all: '3' }
 */
function requestCounts() {
    return knex('requests')
    .select(knex.raw('COUNT(DISTINCT phone) AS phone_count, COUNT(DISTINCT case_id) AS case_count'))
    .first()
 }

/**
 * Counts of SMS hits within last daysback days by action type
 * @param {*} daysback
 */
function actionCounts(daysback = 7){
     return knex.raw(`
     SELECT action as type, COUNT(*)
     FROM log_hits
     WHERE time > CURRENT_DATE - '1 DAYS'::INTERVAL * :days AND action IS NOT NULL
     GROUP BY action;
     `, {days: daysback})
     .then(r => r.rows)
 }

/**
 * Counts of notifications within last daysback days by type
 * @param {Number} daysback
 */
 function notificationCounts(daysback = 7){
    return knex.raw(`
    SELECT type, COUNT(*)
    FROM notifications
    WHERE created_at > CURRENT_DATE - '1 DAYS'::INTERVAL * :days
    GROUP BY type;
    `, {days: daysback})
    .then(r => r.rows)
}

/**
 * Get requests and associated notifactions from a case_id
 * @param {String} case_id
 */
function findRequestNotifications(case_id) {
    case_id = case_id.toUpperCase().trim();
    return knex.raw(`
    SELECT r.case_id, r.phone, r.created_at, r.active, json_agg(n) as notifications
    FROM requests r
    LEFT JOIN notifications n ON (r.case_id = n.case_id AND r.phone = n.phone)
    WHERE r.case_id = :case_id
    GROUP BY (r.case_id, r.phone)
    `, {case_id: case_id})
    .then(r => r.rows)
 }

/**
 * Get all requests associated with a phone number
 * @param {String} encypted phone number
 */
 function findRequestsFromPhone(phone) {
    // expects encypted phone
    return knex.raw(`
    SELECT r.case_id, r.phone, r.created_at, r.active, json_agg(n) as notifications
    FROM requests r
    LEFT JOIN notifications n ON (r.case_id = n.case_id AND r.phone = n.phone)
    WHERE r.phone = :phone
    GROUP BY (r.case_id, r.phone)
    `, {phone: phone})
    .then(r => r.rows)
 }

 /**
  * A logs from a particular phone
  * @param {String} encypted phone number
  */
 function phoneLog(phone){
    return knex.raw(`
    SELECT *
    FROM log_hits
    WHERE phone = :phone
    ORDER BY time DESC;
    `, {phone: phone})
    .then(r => r.rows)
 }

/**
 * The last run dates from runner scripts
 */
 function notificationRunnerLog(){
     return knex.raw(`
     SELECT runner,
     MAX(date) as date
     FROM log_runners GROUP BY runner;
     `)
     .then(r => r.rows)
 }

 /**
  * The notfications associated with a specific case_id
  * @param {string} case_id
  */
 function notificationsFromCitation(case_id) {
     return knex('notifications')
     .where('case_id', case_id)
 }


/**
 * Returns logged action counts grouped by day
 * @param {Number} daysback (ooptional)
 */
function actionsByDay(daysback = 30){
    return knex.raw(`
    SELECT day, json_agg(jsonb_build_object('type', action, 'count', count)) as actions
    FROM (
        SELECT action, time::date as day, COUNT(*)
        FROM log_hits
        WHERE ACTION is NOT NULL
        AND time >  CURRENT_DATE - '1 DAYS'::INTERVAL * :days
        GROUP BY (action, day)
    ) act
    GROUP BY day
    ORDER BY day;
    `, {days: daysback})
    .then(r => r.rows)
}

/**
 * All notifications since daysback [default 30 days]
 * @param {Number} daysback (optional)
 */
function recentNotifications(daysback = 30){
    return knex.raw(`
    SELECT type, json_agg(jsonb_build_object(
        'case_id', case_id,
        'created_at', created_at,
        'phone', phone,
        'event_date', event_date)
        ORDER BY created_at DESC
    ) AS notices
    FROM notifications
    WHERE created_at  > CURRENT_DATE - '1 DAYS'::INTERVAL * :days
    GROUP BY type
    ORDER BY type DESC;
    `, {days: daysback})
    .then(r => r.rows)
}

 module.exports = {
    findHearing,
    hearingCount,
    requestCounts,
    findRequestNotifications,
    findRequestsFromPhone,
    phoneLog,
    actionCounts,
    actionsByDay,
    notificationCounts,
    notificationRunnerLog,
    recentNotifications
 }
