from django.shortcuts import render
from django.http import HttpResponse

# Create your views here.

def index(request):
    print(request)
    return HttpResponse("Django Application Created By Serverless Component")

def author(request):
    print(request)
    return HttpResponse("Tencent Cloud Serverless Team")
