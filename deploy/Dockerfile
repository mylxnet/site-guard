# 网站哨兵 Site Guard · 单容器自托管
# 构建（在仓库根目录执行）：
#   docker build -f deploy/Dockerfile -t site-guard:<版本> .
# 运行：
#   docker run -d --name site-guard -p 8686:8686 -v site-guard-data:/data -e TZ=Asia/Shanghai site-guard:<版本>
FROM node:22-alpine

# 运行时环境：生产模式、监听端口、SQLite 数据目录、时区
ENV NODE_ENV=production \
    PORT=8686 \
    DATA_DIR=/data \
    TZ=Asia/Shanghai

WORKDIR /app

# 先安装依赖（唯一运行时依赖 nodemailer，纯 JS），用国内源加速
COPY package.json package-lock.json ./
RUN npm config set registry https://registry.npmmirror.com \
    && npm config set replace-registry-host always \
    && npm ci --omit=dev \
    && npm cache clean --force

# 复制后端源码与前端静态资源
COPY src ./src
COPY public ./public

# SQLite 数据目录（单文件），以非 root 用户运行
RUN mkdir -p /data && chown -R node:node /data
VOLUME /data
USER node

EXPOSE 8686

CMD ["node", "src/server.js"]