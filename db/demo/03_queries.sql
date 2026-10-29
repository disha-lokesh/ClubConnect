-- ClubConnect | Demo 03 | SELECT: joins, aggregates, GROUP BY / HAVING, nested, correlated, recursive CTE, window functions.
\pset border 2
\echo '== Q1 INNER JOIN (4 tables): published events with club, category and venue'
SELECT e.event_id, e.title, c.name AS club, cat.name AS category, v.name AS venue, e.start_time AT TIME ZONE 'Asia/Kolkata' AS start_ist
  FROM events e JOIN clubs c USING (club_id) JOIN event_categories cat USING (category_id) JOIN venues v USING (venue_id)
 WHERE e.status = 'APPROVED' ORDER BY e.start_time LIMIT 8;

\echo '== Q2 LEFT JOIN: every club with its number of approved events (clubs with none still appear)'
SELECT c.name, count(e.event_id) AS approved_events FROM clubs c LEFT JOIN events e ON e.club_id = c.club_id AND e.status = 'APPROVED' GROUP BY c.club_id ORDER BY approved_events DESC, c.name;

\echo '== Q3 GROUP BY + HAVING: events with more than 20 confirmed registrations'
SELECT e.title, count(*) AS confirmed FROM events e JOIN registrations r USING (event_id) WHERE r.status = 'CONFIRMED' GROUP BY e.event_id HAVING count(*) > 20 ORDER BY confirmed DESC;

\echo '== Q4 NESTED (IN subquery): students who attended at least one Technical event (including sub-categories via Q7 idea)'
SELECT DISTINCT u.full_name FROM users u WHERE u.user_id IN (
  SELECT r.student_id FROM registrations r JOIN attendance a USING (registration_id) JOIN events e USING (event_id)
   WHERE a.present AND e.category_id IN (SELECT category_id FROM event_categories WHERE name IN ('Technical','AI/ML','Computer Vision','Web Development','Cybersecurity'))) ORDER BY 1 LIMIT 10;

\echo '== Q5 NESTED (NOT EXISTS): students who never registered for any event'
SELECT count(*) AS students_without_registrations FROM students s WHERE NOT EXISTS (SELECT 1 FROM registrations r WHERE r.student_id = s.user_id);

\echo '== Q6 CORRELATED subquery: events whose fill % beats the average of their own club'
SELECT s.title, round(s.fill_percent,1) AS fill_percent,
       (SELECT round(avg(s2.fill_percent),1) FROM event_registration_summary s2 WHERE s2.club_id = s.club_id AND s2.event_status='APPROVED') AS club_avg
  FROM event_registration_summary s
 WHERE s.event_status = 'APPROVED' AND s.fill_percent > (SELECT avg(s2.fill_percent) FROM event_registration_summary s2 WHERE s2.club_id = s.club_id AND s2.event_status='APPROVED')
 ORDER BY s.fill_percent DESC;

\echo '== Q7 RECURSIVE CTE: the category tree with depth and path'
SELECT repeat('   ', depth) || name AS category, path FROM category_tree ORDER BY path;

\echo '== Q8 RECURSIVE CTE: all descendants of "Technical"'
WITH RECURSIVE sub AS (
  SELECT category_id, name, 0 AS depth FROM event_categories WHERE name = 'Technical'
  UNION ALL SELECT c.category_id, c.name, s.depth + 1 FROM event_categories c JOIN sub s ON c.parent_category_id = s.category_id)
SELECT * FROM sub ORDER BY depth, name;

\echo '== Q9 (non-recursive) CTE: attendance rate per club, then rank them'
WITH per_club AS (
  SELECT c.name AS club, count(*) FILTER (WHERE r.status='CONFIRMED') AS confirmed, count(*) FILTER (WHERE a.present) AS attended
    FROM clubs c JOIN events e ON e.club_id = c.club_id AND e.status='APPROVED' JOIN registrations r ON r.event_id = e.event_id LEFT JOIN attendance a ON a.registration_id = r.registration_id
   WHERE e.start_time < now() GROUP BY c.club_id)
SELECT club, confirmed, attended, round(100.0 * attended / NULLIF(confirmed,0), 1) AS attendance_pct, rank() OVER (ORDER BY attended::numeric / NULLIF(confirmed,0) DESC) AS rnk FROM per_club;

\echo '== Q10 WINDOW functions: running total of confirmed registrations per event over time, per club'
SELECT club, title, start_ist, confirmed, sum(confirmed) OVER (PARTITION BY club ORDER BY start_ist) AS running_total
  FROM (SELECT c.name AS club, e.title, e.start_time AT TIME ZONE 'Asia/Kolkata' AS start_ist, count(r.*) FILTER (WHERE r.status='CONFIRMED') AS confirmed
          FROM events e JOIN clubs c USING (club_id) LEFT JOIN registrations r USING (event_id) WHERE e.status='APPROVED' GROUP BY c.name, e.event_id) x ORDER BY club, start_ist;

\echo '== Q11 Set operation: students registered for BOTH Battle of Bands AND Hackathon (INTERSECT)'
SELECT student_id FROM registrations r JOIN events e USING (event_id) WHERE e.title = 'Battle of Bands' AND r.status='CONFIRMED'
INTERSECT SELECT student_id FROM registrations r JOIN events e USING (event_id) WHERE e.title LIKE '24-Hour Hackathon' AND r.status='CONFIRMED' ORDER BY 1 LIMIT 10;

\echo '== Q12 Full-text search with ranking (GIN index on a generated tsvector)'
SELECT title, ts_rank(search_vector, q) AS rank FROM events, to_tsquery('english', 'photograph:*') q WHERE search_vector @@ q ORDER BY rank DESC;

\echo '== Q13 Views: the five application views'
SELECT * FROM event_registration_summary ORDER BY event_id LIMIT 5;
SELECT * FROM venue_conflicts;
