-- PickleCourt Booking System — MySQL reference schema
-- The demo server ships with a JSON-file store (data/db.json) whose tables
-- mirror this schema 1:1, so migrating to MySQL only requires swapping the
-- data layer in server/db.js.

CREATE DATABASE IF NOT EXISTS picklecourt CHARACTER SET utf8mb4;
USE picklecourt;

CREATE TABLE roles (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(40) NOT NULL,
  permissions JSON NOT NULL
);

CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  role_id INT NOT NULL DEFAULT 5,
  username VARCHAR(60) NOT NULL UNIQUE,
  email VARCHAR(120) NOT NULL UNIQUE,
  password_hash VARCHAR(120) NOT NULL,
  first_name VARCHAR(60) NOT NULL,
  middle_name VARCHAR(60),
  last_name VARCHAR(60) NOT NULL,
  birthday DATE NOT NULL,
  gender VARCHAR(24) NOT NULL,
  nationality VARCHAR(60) NOT NULL,
  mobile VARCHAR(20) NOT NULL,
  address VARCHAR(255) NOT NULL,
  emergency_name VARCHAR(120),
  emergency_relationship VARCHAR(60),
  emergency_contact VARCHAR(20),
  photo VARCHAR(255),
  verified TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  blacklisted TINYINT(1) NOT NULL DEFAULT 0,
  membership VARCHAR(20),
  notify_settings JSON,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES roles(id)
);

CREATE TABLE courts (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(60) NOT NULL,
  type ENUM('Indoor','Outdoor') NOT NULL,
  surface VARCHAR(80),
  lighting TINYINT(1) DEFAULT 1,
  airconditioned TINYINT(1) DEFAULT 0,
  capacity INT DEFAULT 4,
  size VARCHAR(40),
  status ENUM('Available','Unavailable','Maintenance') DEFAULT 'Available',
  image VARCHAR(255),
  price_weekday DECIMAL(10,2) NOT NULL,
  price_weekend DECIMAL(10,2) NOT NULL,
  price_holiday DECIMAL(10,2) NOT NULL,
  price_peak DECIMAL(10,2) NOT NULL,
  price_offpeak DECIMAL(10,2) NOT NULL,
  description TEXT
);

CREATE TABLE bookings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  ref VARCHAR(24) NOT NULL UNIQUE,           -- PB-YYYYMMDD-000001
  user_id INT NOT NULL,
  court_id INT NOT NULL,
  date DATE NOT NULL,
  start_hour INT NOT NULL,
  duration INT NOT NULL,
  players INT NOT NULL,
  promo VARCHAR(30),
  subtotal DECIMAL(10,2) NOT NULL,
  discount DECIMAL(10,2) NOT NULL DEFAULT 0,
  vat DECIMAL(10,2) NOT NULL DEFAULT 0,
  total DECIMAL(10,2) NOT NULL,
  status ENUM('Pending','Approved','Rejected','Cancelled','Completed') DEFAULT 'Pending',
  payment_status ENUM('Pending','Paid','Rejected','Refunded') DEFAULT 'Pending',
  assigned_staff VARCHAR(60),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (court_id) REFERENCES courts(id),
  UNIQUE KEY no_double_booking (court_id, date, start_hour)
);

CREATE TABLE booking_details (            -- equipment/services line items
  id INT PRIMARY KEY AUTO_INCREMENT,
  booking_id INT NOT NULL,
  item_type ENUM('equipment','service') NOT NULL,
  item_key VARCHAR(30) NOT NULL,
  name VARCHAR(60) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
);

CREATE TABLE payments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  booking_id INT NOT NULL,
  user_id INT NOT NULL,
  method ENUM('GCash','Maya','Bank Transfer','Credit Card','Cash at Venue') NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  proof_file VARCHAR(255),
  reference VARCHAR(80),
  status ENUM('Pending','Verified','Rejected','Refunded') DEFAULT 'Pending',
  verified_by VARCHAR(60),
  verified_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE equipment (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(60) NOT NULL,
  item_key VARCHAR(30) NOT NULL UNIQUE,
  price DECIMAL(10,2) NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  unit VARCHAR(20)
);

CREATE TABLE equipment_rental (
  id INT PRIMARY KEY AUTO_INCREMENT,
  booking_id INT NOT NULL,
  equipment_id INT NOT NULL,
  qty INT NOT NULL DEFAULT 1,
  FOREIGN KEY (booking_id) REFERENCES bookings(id),
  FOREIGN KEY (equipment_id) REFERENCES equipment(id)
);

CREATE TABLE memberships (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(20) NOT NULL,               -- Silver / Gold / Platinum
  price DECIMAL(10,2) NOT NULL,
  discount INT NOT NULL,
  benefits JSON
);

CREATE TABLE promo_codes (
  id INT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(30) NOT NULL UNIQUE,
  type ENUM('percent','fixed') NOT NULL,
  value DECIMAL(10,2) NOT NULL,
  expires DATE NOT NULL,
  usage_limit INT NOT NULL DEFAULT 100,
  used INT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1
);

CREATE TABLE notifications (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  type VARCHAR(20) NOT NULL,
  title VARCHAR(120) NOT NULL,
  message TEXT,
  `read` TINYINT(1) NOT NULL DEFAULT 0,
  at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE audit_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT,
  action VARCHAR(60) NOT NULL,
  details TEXT,
  at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE reports (
  id INT PRIMARY KEY AUTO_INCREMENT,
  type VARCHAR(30) NOT NULL,
  range_from DATE,
  range_to DATE,
  generated_by INT,
  generated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE court_maintenance (
  id INT PRIMARY KEY AUTO_INCREMENT,
  court_id INT NOT NULL,
  date DATE NOT NULL,
  note VARCHAR(255),
  FOREIGN KEY (court_id) REFERENCES courts(id)
);
