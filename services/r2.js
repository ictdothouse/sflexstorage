// services/r2.js
// Wrapper for Cloudflare R2 using AWS SDK S3 client
const { S3Client, PutObjectCommand, DeleteObjectCommand, HeadBucketCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const path = require("path");

let client = null;
let bucket = null;
let publicUrl = null; // base public URL for the bucket (e.g., https://<account>.r2.cloudflarestorage.com/<bucket>)

function init(config) {
  const { accountId, accessKeyId, secretAccessKey, bucketName, publicBucketUrl } = config;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error("Missing required R2 configuration");
  }
  client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
  bucket = bucketName;
  publicUrl = publicBucketUrl?.replace(/\/*$/, ""); // ensure no trailing slash
}

async function upload(filePath, key) {
  if (!client) throw new Error("R2 client not initialized");
  const fileStream = require("fs").createReadStream(filePath);
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: fileStream,
    ACL: "public-read",
  });
  await client.send(command);
  return `${publicUrl}/${key}`; // public URL
}

async function deleteObject(key) {
  if (!client) throw new Error("R2 client not initialized");
  const command = new DeleteObjectCommand({ Bucket: bucket, Key: key });
  await client.send(command);
}

function getPublicUrl(key) {
  return `${publicUrl}/${key}`;
}

async function testConnection(config) {
  const { accountId, accessKeyId, secretAccessKey, bucketName } = config;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error('Missing required R2 configuration fields');
  }
  const testClient = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  // ListObjectsV2 with MaxKeys=1 is a lightweight way to verify credentials + bucket
  await testClient.send(new ListObjectsV2Command({ Bucket: bucketName, MaxKeys: 1 }));
  return true;
}

module.exports = { init, upload, deleteObject, getPublicUrl, testConnection };
