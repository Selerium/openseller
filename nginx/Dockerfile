FROM nginx:alpine

RUN apk add --no-cache certbot openssl

COPY default.conf /etc/nginx/templates/default.conf
COPY default.dev.conf /etc/nginx/templates/default.dev.conf
COPY entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh && mkdir -p /var/www/certbot

EXPOSE 80 443

ENTRYPOINT ["/entrypoint.sh"]
