<?php
require __DIR__ . '/_init.php';
$_SESSION = [];
session_destroy();
header('Location: login.php');
