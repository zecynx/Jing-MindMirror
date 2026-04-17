FROM node:lts-alpine

WORKDIR /app

# 国内镜像加速
RUN npm config set registry https://registry.npmmirror.com

# 先安装依赖（利用 Docker 缓存层）
COPY package.json package-lock.json* ./
RUN npm ci --only=production

# 拷贝源代码
COPY . .

# 创建数据目录
RUN mkdir -p /app/data

# 环境变量
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
