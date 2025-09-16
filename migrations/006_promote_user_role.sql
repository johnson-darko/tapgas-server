-- Promote a user to driver
UPDATE users
SET role = 'driver'
WHERE email = 'user@gmail.com';

-- Promote a user to admin
UPDATE users
SET role = 'admin'
WHERE email = 'user@gmail.com';
