"""Independent ImageGrab research tables in the existing Shop database."""
from django.contrib.auth.models import User
from django.db import models
from django.utils.timezone import now


class ImageGrabYouProduct(models.Model):
    client_id = models.CharField(max_length=64)
    external_id = models.CharField(max_length=160)
    title = models.CharField(max_length=500, blank=True, default='')
    brand = models.CharField(max_length=160, blank=True, default='')
    category = models.CharField(max_length=160, blank=True, default='')
    source_type = models.CharField(max_length=32, blank=True, default='')
    source_url = models.TextField(blank=True, default='')
    scope = models.JSONField(default=dict, blank=True)
    images = models.JSONField(default=list, blank=True)
    certificates = models.JSONField(default=list, blank=True)
    payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=now)
    updated_at = models.DateTimeField(auto_now=True)
    synced_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name='+')

    class Meta:
        db_table = 'imagegrab_you_product'
        ordering = ['-updated_at', '-id']
        constraints = [models.UniqueConstraint(fields=['client_id', 'external_id'], name='ig_you_product_key')]


class ImageGrabYouOffer(models.Model):
    product = models.ForeignKey(ImageGrabYouProduct, on_delete=models.CASCADE, related_name='offers')
    source_key = models.CharField(max_length=160)
    offer_id = models.CharField(max_length=64, default='', blank=True)
    title = models.CharField(max_length=500, default='', blank=True)
    url = models.TextField(default='', blank=True)
    supplier_name = models.CharField(max_length=240, default='', blank=True)
    supplier_url = models.TextField(default='', blank=True)
    price_text = models.CharField(max_length=240, default='', blank=True)
    moq_text = models.CharField(max_length=240, default='', blank=True)
    sales_text = models.CharField(max_length=500, default='', blank=True)
    ship_from = models.CharField(max_length=240, default='', blank=True)
    customer_service = models.JSONField(default=dict, blank=True)
    images = models.JSONField(default=list, blank=True)
    details = models.JSONField(default=dict, blank=True)
    detail_status = models.CharField(max_length=32, default='pending')
    payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'imagegrab_you_offer'
        ordering = ['-updated_at', '-id']
        constraints = [models.UniqueConstraint(fields=['product', 'source_key'], name='ig_you_offer_key')]


class ImageGrabYouJob(models.Model):
    client_id = models.CharField(max_length=64)
    run_id = models.CharField(max_length=160)
    status = models.CharField(max_length=32, default='pending')
    total = models.PositiveIntegerField(default=0)
    done = models.PositiveIntegerField(default=0)
    failed = models.PositiveIntegerField(default=0)
    payload = models.JSONField(default=dict, blank=True)
    user = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name='+')
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'imagegrab_you_job'
        ordering = ['-updated_at', '-id']
        constraints = [models.UniqueConstraint(fields=['client_id', 'run_id'], name='ig_you_job_key')]


class ImageGrabYouRequest(models.Model):
    client_id = models.CharField(max_length=64)
    external_id = models.CharField(max_length=160)
    title = models.CharField(max_length=500, blank=True, default='')
    criteria = models.JSONField(default=dict, blank=True)
    reference = models.JSONField(default=dict, blank=True)
    payload = models.JSONField(default=dict, blank=True)
    parent = models.ForeignKey('self', null=True, blank=True, on_delete=models.PROTECT, related_name='searches')
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'imagegrab_you_request'
        ordering = ['-updated_at', '-id']
        constraints = [models.UniqueConstraint(fields=['client_id', 'external_id'], name='ig_you_request_key')]


class ImageGrabYouCandidate(models.Model):
    request = models.ForeignKey(ImageGrabYouRequest, on_delete=models.CASCADE, related_name='candidates')
    offer = models.ForeignKey(ImageGrabYouOffer, null=True, blank=True, on_delete=models.SET_NULL, related_name='sourcing_links')
    candidate_key = models.CharField(max_length=160)
    payload = models.JSONField(default=dict, blank=True)
    evidence = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'imagegrab_you_candidate'
        constraints = [models.UniqueConstraint(fields=['request', 'offer'], name='ig_you_candidate_key'),
                       models.UniqueConstraint(fields=['request', 'candidate_key'], name='ig_you_pool_candidate_key')]
