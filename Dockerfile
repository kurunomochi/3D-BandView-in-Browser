FROM rust:1-bookworm AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY scripts/export-model.py ./scripts/export-model.py
RUN cargo build --locked --release

FROM debian:bookworm-slim
RUN groupadd --gid 10001 blog && useradd --uid 10001 --gid blog --no-create-home blog && mkdir -p /app/data && chown blog:blog /app/data
WORKDIR /app
COPY --from=build /app/target/release/blog /app/blog
COPY public ./public
USER blog
ENV BLOG_BIND=0.0.0.0:3000 BLOG_DATA_DIR=/app/data
EXPOSE 3000
CMD ["/app/blog"]
