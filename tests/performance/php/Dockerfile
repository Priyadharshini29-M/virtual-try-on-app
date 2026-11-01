# TEST-ONLY image: builds a COPY of fitfyce-php and redirects the RunPod base URL to the mock.
# The repository source is never modified; the sed below runs on the copy inside the image.
# Build context = ../../fitfyce-php (see docker-compose.yml). Secrets/.env are excluded by Dockerfile.dockerignore.
FROM php:8.3-apache-bookworm

RUN sed -i "s|http://deb.debian.org|https://deb.debian.org|g" /etc/apt/sources.list.d/debian.sources && apt-get update && apt-get install -y --no-install-recommends \
      libpng-dev libjpeg62-turbo-dev libfreetype6-dev \
    && docker-php-ext-configure gd --with-jpeg --with-freetype \
    && docker-php-ext-install -j2 gd exif pdo_mysql opcache \
    && a2enmod rewrite status \
    && rm -rf /var/lib/apt/lists/*

COPY . /var/www/html

# Point the RunPod client at the mock (fail the build if the pattern is not found).
RUN grep -q 'https://api.runpod.ai/v2' /var/www/html/src/RunpodVtonClient.php \
 && sed -i 's#https://api.runpod.ai/v2#http://mock-ai:4010/v2#g' /var/www/html/src/RunpodVtonClient.php \
 && grep -q 'mock-ai:4010' /var/www/html/src/RunpodVtonClient.php

# Point the Fashn client at the mock too (saree engine) so the credits fallback can be tested.
RUN grep -q 'https://api.fashn.ai/v1' /var/www/html/src/FashnClient.php  && sed -i 's#https://api.fashn.ai/v1#http://mock-ai:4010/fashn/v1#g' /var/www/html/src/FashnClient.php  && grep -q 'mock-ai:4010/fashn' /var/www/html/src/FashnClient.php

# Let /server-status bypass the app's catch-all rewrite (copy only) so worker saturation can be sampled.
RUN sed -i '/RewriteEngine On/a RewriteCond %{REQUEST_URI} !^/server-status' /var/www/html/.htaccess \
 && grep -q 'server-status' /var/www/html/.htaccess

# Writable runtime dirs the app expects.
RUN mkdir -p /var/www/html/results /var/www/html/temp /var/www/html/logs \
 && chown -R www-data:www-data /var/www/html/results /var/www/html/temp /var/www/html/logs

# Apache: honour .htaccess, cap workers (APACHE_MAX_WORKERS) to mimic a small shared host, expose /server-status.
RUN sed -i 's#AllowOverride None#AllowOverride All#g' /etc/apache2/apache2.conf \
 && printf '<IfModule mpm_prefork_module>\n  StartServers 4\n  MinSpareServers 4\n  MaxSpareServers 8\n  ServerLimit ${APACHE_MAX_WORKERS}\n  MaxRequestWorkers ${APACHE_MAX_WORKERS}\n  MaxConnectionsPerChild 0\n</IfModule>\n' > /etc/apache2/mods-available/mpm_prefork.conf \
 && printf '<Location "/server-status">\n  SetHandler server-status\n  Require all granted\n</Location>\nExtendedStatus On\n' > /etc/apache2/conf-available/status-test.conf \
 && a2enconf status-test

# KeepAlive: prefork pins one worker per idle keep-alive connection, which does not happen on the real LiteSpeed host.
# Default is OFF here so MaxRequestWorkers behaves like a cap on concurrent PHP processes (set APACHE_KEEPALIVE=On to see the artefact).
RUN echo 'KeepAlive ${APACHE_KEEPALIVE}' > /etc/apache2/conf-available/keepalive-test.conf && a2enconf keepalive-test

COPY --from=perf php.ini /usr/local/etc/php/conf.d/zz-perf.ini
