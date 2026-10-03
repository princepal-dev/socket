FROM maven:3.9.9-eclipse-temurin-17 AS build
WORKDIR /workspace

COPY pom.xml ./
RUN mvn -B -DskipTests dependency:go-offline

COPY src ./src
RUN mvn -B -DskipTests clean package

FROM eclipse-temurin:17-jre-jammy AS runtime
WORKDIR /app

RUN groupadd -r spring && useradd -r -g spring spring
RUN mkdir -p /app/storage && chown -R spring:spring /app

ENV SPRING_FILE_BASE_PATH=/app/storage \
    SPRING_SERVLET_MULTIPART_MAX_FILE_SIZE=50MB \
    SPRING_SERVLET_MULTIPART_MAX_REQUEST_SIZE=60MB

COPY --from=build /workspace/target/*.jar /app/app.jar

EXPOSE 8080
VOLUME ["/app/storage"]
USER spring

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
