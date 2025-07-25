# document template
bit.ly/EtplV1

# browse api from
http://localhost:8080/docs

# generate jar file
mvnw clean install
# tests are skip by default to test add maven parameter -Dmaven.test.skip=false
mvnw -Dmaven.test.skip=false clean install
 
#docker
sudo docker build -f Dockerfile -t report-server:latest .
 
## publish to docker.io
$ sudo docker tag report-server:latest docker.io/tofilagman/report-server
$ sudo docker push tofilagman/report-server:latest
  
#linux 
$ sudo docker pull tofilagman/report-server:latest
 
## cleanup unused images
$ docker image prune -a

# docker compose
> copy docker-compose-prod.yml to server
$ scp docker-compose-prod.yml ubuntu@139.99.69.58:/tmp 
$ docker compose -f docker-compose-prod.yml up --pull always -d
$ docker compose down 

# inspect files
docker run -it --entrypoint sh philsure
   
# delete all docker images
$ for /F %i in ('docker images -a -q') do docker rmi -f %i
$ docker image prune -a -f
 

