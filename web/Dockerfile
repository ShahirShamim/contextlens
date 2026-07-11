FROM nginx:alpine

COPY default.conf /etc/nginx/conf.d/default.conf
COPY index.html app.js styles.css og.png /usr/share/nginx/html/
COPY data /usr/share/nginx/html/data

EXPOSE 8080
