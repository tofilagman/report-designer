FROM maven:3.9.10-eclipse-temurin-21-alpine AS backend

WORKDIR /app 
COPY ./report-server /app

RUN rm -rf /app/temp
RUN mkdir -p /app/temp

RUN --mount=type=cache,target=/root/.m2 mvn clean install

FROM debian:trixie-slim AS final
  
RUN apt-get update 
RUN apt-get install -y wget
RUN wget https://download.java.net/java/GA/jdk21.0.1/415e3f918a1f4062a0074a2794853d0d/12/GPL/openjdk-21.0.1_linux-x64_bin.tar.gz
RUN tar xvf openjdk-21.0.1_linux-x64_bin.tar.gz
RUN mv jdk-21.0.1/ /usr/local/jdk-21
RUN apt-get install -y unzip libglib2.0-0 libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libxkbcommon0 libxcomposite1 libxdamage1
RUN apt-get install -y libxfixes3 libxrandr2 libgbm1 libasound2
RUN apt update
RUN apt install -y libpango-1.0-0 libcairo2
RUN ldconfig
 
RUN mkdir "/app/temp" -p
VOLUME ["/app/temp"] 

WORKDIR /app
COPY --from=backend /app/target/report-server-0.0.1.jar .
 
EXPOSE 8080
 
ENTRYPOINT exec /usr/local/jdk-21/bin/java $JAVA_OPTS -jar /app/report-server-0.0.1.jar $ARGS
