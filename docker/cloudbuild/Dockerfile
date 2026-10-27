FROM docker:29.9.2-cli@sha256:98776017a505b6d89c0adff8c63b0d8701ca10280c41315dbb0638fe3b5cf6e5 AS docker
FROM eclipse-temurin:17-jdk-jammy@sha256:1d4fdea2c842d8830bfb34fe4f0faf9bdad8432f79c7d1a117f1f3ee4ad46e5b AS java
FROM node:24.22.1-bookworm@sha256:f9b3548b20b15b705b66aeecaeac7dd690c73d5e4661357aac02e60e3d38c88a
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx
COPY --from=java /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk
ENV BLOGPOST_JAVA_HOME=/opt/java/openjdk
RUN node --version && npm --version && git --version && docker --version && docker buildx version && /opt/java/openjdk/bin/java -version
WORKDIR /workspace
ENTRYPOINT ["node"]
