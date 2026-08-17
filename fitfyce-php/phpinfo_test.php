<?php
header('Content-Type: application/json');
echo json_encode(['php' => PHP_VERSION, 'ok' => true]);
