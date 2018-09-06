
const axios = require('axios')
let response;

/**
 *
 * Event doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
 * @param {Object} event - API Gateway Lambda Proxy Input Format
 * @param {string} event.resource - Resource path.
 * @param {string} event.path - Path parameter.
 * @param {string} event.httpMethod - Incoming request's method name.
 * @param {Object} event.headers - Incoming request headers.
 * @param {Object} event.queryStringParameters - query string parameters.
 * @param {Object} event.pathParameters - path parameters.
 * @param {Object} event.stageVariables - Applicable stage variables.
 * @param {Object} event.requestContext - Request context, including authorizer-returned key-value pairs, requestId, sourceIp, etc.
 * @param {Object} event.body - A JSON string of the request payload.
 * @param {boolean} event.body.isBase64Encoded - A boolean flag to indicate if the applicable request payload is Base64-encode
 *
 * Context doc: https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html
 * @param {Object} context
 * @param {string} context.logGroupName - Cloudwatch Log Group name
 * @param {string} context.logStreamName - Cloudwatch Log stream name.
 * @param {string} context.functionName - Lambda function name.
 * @param {string} context.memoryLimitInMB - Function memory.
 * @param {string} context.functionVersion - Function version identifier.
 * @param {function} context.getRemainingTimeInMillis - Time in milliseconds before function times out.
 * @param {string} context.awsRequestId - Lambda request ID.
 * @param {string} context.invokedFunctionArn - Function ARN.
 *
 * Return doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
 * @returns {Object} object - API Gateway Lambda Proxy Output Format
 * @returns {boolean} object.isBase64Encoded - A boolean flag to indicate if the applicable payload is Base64-encode (binary support)
 * @returns {string} object.statusCode - HTTP Status Code to be returned to the client
 * @returns {Object} object.headers - HTTP Headers to be returned
 * @returns {Object} object.body - JSON Payload to be returned
 *
 */

var aws   = require('aws-sdk');
var url   = require('url');
var https = require('https');
var cw    = new aws.CloudWatch({region: 'us-east-1', endpoint: 'https://monitoring.us-east-1.amazonaws.com'});

// Slackのチャンネル名を指定。
var channel_name = 'robots';

// Slack Incoming Webhook URLを指定。
// var channel_url  = 'https://hooks.slack.com/services/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';
var channel_url  = "https://hooks.slack.com/services/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";

// サービス名を配列で指定。
var serviceNames = ['AmazonEC2', 'AmazonRDS', 'AmazonRoute53', 'AmazonS3', 'AmazonSNS', 'AWSDataTransfer', 'AWSLambda', 'AWSQueueService'];

var floatFormat = function(number, n) {
    number = number * 110;
    var _pow = Math.pow(10 , n);
    return Math.round(number * _pow)  / _pow;
};

var postBillingToSlack = function(billings, context) {
    var fields = [];
    for (var serviceName in billings) {
        fields.push({
            title: serviceName,
            value: floatFormat(billings[serviceName], 2) + " 円",
            short: true
        });
    }
    var message = {
        channel: channel_name,
        attachments: [{
            fallback: '今月のAWSの利用費は、' + floatFormat(billings['Total'], 2) + ' 円です。',
            pretext: '今月のAWSの利用費は…',
            color: 'good',
            fields: fields
        }]
    };
    var body = JSON.stringify(message);
    var options = url.parse(channel_url);
    options.method = 'POST';
    options.header = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
    };
    var statusCode;
    var postReq = https.request(options, function(res) {
        var chunks = [];
        res.setEncoding('utf8');
        res.on('data', function(chunk) {
            return chunks.push(chunk);
        });
        res.on('end', function() {
            var body = chunks.join('');
            statusCode = res.statusCode;
        });
        return res;
    });
    postReq.write(body);
    postReq.end();
    if (statusCode < 400) {
      context.succeed();
    }
};

var getBilling = function(context) {
    var now = new Date();
    var startTime = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1,  0,  0,  0);
    var endTime   = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);

    var billings = {};

    var total_params = {
        MetricName: 'EstimatedCharges',
        Namespace: 'AWS/Billing',
        Period: 86400,
        StartTime: startTime,
        EndTime: endTime,
        Statistics: ['Average'],
        Dimensions: [
            {
                Name: 'Currency',
                Value: 'USD'
            }
        ]
    };

    cw.getMetricStatistics(total_params, function(err, data) {
        if (err) {
            console.error(err, err.stack);
        } else {
            var datapoints = data['Datapoints'];
            if (datapoints.length < 1) {
                billings['Total'] = 0;
            } else {
                billings['Total'] = datapoints[datapoints.length - 1]['Average'];
            }
            if (serviceNames.length > 0) {
                let serviceName = serviceNames.shift();
                getEachServiceBilling(serviceName);
            }
        }
    });

    var getEachServiceBilling = function(serviceName) {
        var params = {
            MetricName: 'EstimatedCharges',
            Namespace: 'AWS/Billing',
            Period: 86400,
            StartTime: startTime,
            EndTime: endTime,
            Statistics: ['Average'],
            Dimensions: [
                {
                    Name: 'Currency',
                    Value: 'USD'
                },
                {
                    Name: 'ServiceName',
                    Value: serviceName
                }
            ]
        };
        cw.getMetricStatistics(params, function(err, data) {
            if (err) {
                console.error(err, err.stack);
            } else {
                var datapoints = data['Datapoints'];
                if (datapoints.length < 1) {
                    billings[serviceName] = 0;
                } else {
                    billings[serviceName] = datapoints[datapoints.length - 1]['Average'];
                }
                if (serviceNames.length > 0) {
                    serviceName = serviceNames.shift();
                    getEachServiceBilling(serviceName);
                } else {
                    postBillingToSlack(billings, context);
                }
            }
        });
    };
};

exports.lambdaHandler = function(event, context) {
    getBilling(context);
};
